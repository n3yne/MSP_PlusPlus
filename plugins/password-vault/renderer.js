// Password Vault plugin — main window renderer
//
// The 🔑 Vault tab in the side panel. Everything secret stays in main.js: this
// tab asks for what it shows (the list has no passwords in it), and Copy is done
// by main.js, so a copied password never passes through here. A password only
// comes here when you open an entry to edit it or press Show.
//
// The tab checks the vault's state when it's shown and every few seconds while
// it's open, so a re-prompt from the timer or a Windows lock clears the list
// straight away. With "Re-prompt immediately", hiding the tab or minimising the
// window asks main.js to re-prompt.
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const PLUGIN_ID = "password-vault";
  const POLL_MS = 5000;
  const MIN_PASSWORD = 12;

  // ==================== Pure helpers ====================

  // Rough strength, 0-4, from length and variety. It can't spot dictionary
  // words, so it's only a nudge.
  function strength(pw) {
    if (typeof pw !== "string" || !pw) return 0;
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/[0-9]/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    const unique = new Set(pw).size;
    const bits = Math.min(pw.length, unique * 2) * Math.log2(Math.max(pool, 2));
    if (bits < 40) return 0;
    if (bits < 60) return 1;
    if (bits < 80) return 2;
    if (bits < 100) return 3;
    return 4;
  }

  const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

  const MESSAGES = {
    "wrong-password": "That master password isn't right.",
    "password-too-short": "The master password needs at least " + MIN_PASSWORD + " characters.",
    "password-too-long": "That password is too long.",
    "password-required": "Enter your master password to make the vault less strict.",
    "locked": "The vault locked. Unlock it again to carry on.",
    "no-vault": "There's no vault yet.",
    "exists": "A vault already exists.",
    "bad-entry": "An entry needs a name.",
    "too-many": "The vault is full (5,000 entries).",
    "not-found": "That entry isn't there any more.",
    "bad-field": "That can't be copied.",
    "bad-file": "The vault file is damaged or isn't a vault file. Your last good copy is vault.json.bak in the plugin's data folder.",
    "bad-version": "This vault was made by a newer version of Password Vault. Update the plugin.",
    "decrypt-failed": "The vault file has been changed or damaged, so it can't be opened. Your last good copy is vault.json.bak in the plugin's data folder.",
    "hello-unavailable": "Windows Hello isn't available. Use your master password.",
    "hello-cancelled": "Windows Hello was cancelled.",
    "hello-not-set-up": "Windows Hello's key for MSP++ is gone. Use your master password, then turn Windows Hello off and on again in the vault's settings.",
    "hello-locked-out": "Windows Hello is locked after too many tries. Use your master password.",
    "hello-busy": "Windows Hello is already open. Check behind the MSP++ window.",
    "hello-failed": "Windows Hello didn't work. Use your master password.",
    "hello-mismatch": "Windows Hello's key has changed, so it can't open this vault. Use your master password, then turn Windows Hello off and on again.",
    "wait": "Too many wrong tries. Wait a moment and try again.",
  };

  function messageFor(res) {
    if (!res) return "Something went wrong.";
    if (res.error === "wait" && res.retryInMs) {
      return "Too many wrong tries. Try again in " + Math.ceil(res.retryInMs / 1000) + " seconds.";
    }
    return MESSAGES[res.error] || "Something went wrong. Try again.";
  }

  function hostOf(url) {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
    } catch {
      return "";
    }
  }

  // Search across name, username, site, folder; then folder filter; sorted by name.
  function filterEntries(entries, query, folder) {
    const q = String(query || "").trim().toLowerCase();
    return (entries || [])
      .filter(function (e) {
        if (folder && e.folder !== folder) return false;
        if (!q) return true;
        return [e.name, e.username, e.url, e.folder].some(function (v) {
          return String(v || "").toLowerCase().indexOf(q) !== -1;
        });
      })
      .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }); });
  }

  function folderList(entries) {
    const set = new Set();
    (entries || []).forEach(function (e) { if (e.folder) set.add(e.folder); });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: "base" }); });
  }

  const REPROMPT_OPTIONS = [
    [0, "Immediately (when you leave this tab)"],
    [15, "After 15 minutes"],
    [60, "After 1 hour"],
    [240, "After 4 hours"],
    [480, "After 8 hours"],
    [-1, "Never, until MSP++ closes"],
  ];
  const CLIPBOARD_OPTIONS = [[10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"], [120, "2 minutes"], [0, "Never"]];

  function repromptLabel(minutes) {
    const o = REPROMPT_OPTIONS.find(function (x) { return x[0] === minutes; });
    return o ? o[1] : "";
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { strength, messageFor, hostOf, filterEntries, folderList, repromptLabel, MESSAGES, REPROMPT_OPTIONS, CLIPBOARD_OPTIONS };
  }

  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ==================== UI ====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function") return;

  function call(action, data) {
    return api.invoke(PLUGIN_ID, action, data || {}).catch(function (err) {
      console.error("[Password Vault]", action, err);
      return { ok: false, error: "failed" };
    });
  }

  const tab = api.ui.addSidePanelTab({
    id: PLUGIN_ID,
    label: "Vault",
    icon: "🔑",
    title: "Password Vault: your passwords, encrypted",
    order: 60,
  });
  const panel = tab.element;
  panel.classList.add("pv-panel");

  let status = null;      // last status from main.js
  let view = "list";      // list | edit | settings (when unlocked)
  let entries = [];
  let query = "";
  let folder = "";
  let editing = null;     // the entry being edited (with its password), or a new one
  let flashMsg = null;    // { text, kind }
  let flashTimer = null;
  let busy = false;
  let pollTimer = null;
  let generatorOpen = false;
  let pendingSettings = null; // settings choices kept while the master password is asked for
  const genOpts = { mode: "chars", length: 20, lower: true, upper: true, digits: true, symbols: true, words: 5 };

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === "className") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "value") el.value = v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function button(label, onClick, cls, title) {
    return h("button", {
      type: "button", className: "btn-small" + (cls ? " " + cls : ""), title: title || null,
      onclick: function (ev) { ev.preventDefault(); ev.stopPropagation(); onClick(ev); },
    }, [label]);
  }

  function flash(text, kind) {
    flashMsg = text ? { text: text, kind: kind || "info" } : null;
    clearTimeout(flashTimer);
    if (text) flashTimer = setTimeout(function () { flashMsg = null; render(); }, 6000);
    render();
  }

  function flashEl() {
    if (!flashMsg) return null;
    return h("div", { className: "pv-flash pv-" + flashMsg.kind, role: "status" }, [flashMsg.text]);
  }

  function passwordInput(id, placeholder, autocomplete) {
    return h("input", {
      type: "password", id: id, className: "pv-input", placeholder: placeholder,
      autocomplete: autocomplete || "off", spellcheck: "false",
    });
  }

  // Takes a status (from status or any action) and redraws if the state changed.
  function applyStatus(res) {
    if (!res || !res.ok || !res.state) return;
    const was = status ? status.state : null;
    status = res;
    if (res.state !== "unlocked") {
      // Drop everything we were showing.
      entries = [];
      editing = null;
      pendingSettings = null;
      generatorOpen = false;
      view = "list";
    }
    if (was !== res.state) {
      if (res.state === "unlocked") loadEntries();
      else render();
    }
  }

  async function refresh() {
    applyStatus(await call("status"));
  }

  async function loadEntries() {
    const res = await call("list");
    if (res.ok) entries = res.entries || [];
    else if (res.error === "locked") return refresh();
    render();
  }

  // Runs an action that returns a status; shows its error, if any.
  async function act(action, data, onDone) {
    if (busy) return;
    busy = true;
    render();
    const res = await call(action, data);
    busy = false;
    if (res.ok) {
      if (res.state) applyStatus(res);
      flashMsg = null;
      if (onDone) onDone(res);
    } else {
      if (res.error === "locked") await refresh();
      flash(messageFor(res), "error");
    }
    render();
    return res;
  }

  // ---------- Views ----------

  function renderSetup() {
    const pw = passwordInput("pv-new", "Master password (at least " + MIN_PASSWORD + " characters)", "new-password");
    const pw2 = passwordInput("pv-new2", "Type it again", "new-password");
    const meter = h("div", { className: "pv-meter" }, [h("span", { className: "pv-meter-bar" })]);
    const meterLabel = h("span", { className: "pv-muted" }, [""]);
    const understand = h("input", { type: "checkbox", id: "pv-understand" });
    const create = h("button", { type: "submit", className: "btn btn-primary", disabled: true }, ["Create vault"]);

    function update() {
      const s = strength(pw.value);
      meter.firstChild.style.width = pw.value ? ((s + 1) * 20) + "%" : "0";
      meter.dataset.level = String(s);
      meterLabel.textContent = pw.value ? STRENGTH_LABELS[s] : "";
      create.disabled = busy || pw.value.length < MIN_PASSWORD || pw.value !== pw2.value || !understand.checked;
    }
    pw.addEventListener("input", update);
    pw2.addEventListener("input", update);
    understand.addEventListener("change", update);

    const form = h("form", {
      className: "pv-form",
      onsubmit: function (ev) {
        ev.preventDefault();
        if (pw.value !== pw2.value) return flash("The two passwords don't match.", "error");
        act("create", { password: pw.value });
      },
    }, [
      h("h3", { className: "pv-title" }, ["Set up your vault"]),
      h("p", { className: "pv-muted" }, ["Everything in the vault is encrypted with a key that only your master password opens. ",
        "You'll need it every time MSP++ starts."]),
      pw, pw2,
      h("div", { className: "pv-meter-row" }, [meter, meterLabel]),
      h("p", { className: "pv-muted" }, ["Tip: a few unrelated words make a long password that's easy to remember."]),
      h("label", { className: "pv-check pv-warning-box" }, [understand,
        " I understand there is no way to recover the vault if I forget this password."]),
      create,
    ]);
    setTimeout(function () { pw.focus(); }, 0);
    return form;
  }

  function renderLocked() {
    const reprompt = status.state === "reprompt";
    const pw = passwordInput("pv-unlock", "Master password", "current-password");
    const unlock = h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, ["Unlock"]);
    const children = [
      h("div", { className: "pv-lock-icon", "aria-hidden": "true" }, ["🔒"]),
      h("h3", { className: "pv-title" }, [reprompt ? "Confirm it's you" : "Vault locked"]),
      h("p", { className: "pv-muted" }, [reprompt
        ? "It's been a while since you unlocked the vault."
        : "Enter your master password to unlock the vault."]),
    ];
    if (status.helloReady) {
      children.push(h("button", {
        type: "button", className: "btn btn-primary pv-hello", disabled: busy,
        onclick: function () { act("unlock-hello"); },
      }, ["Use Windows Hello"]));
      children.push(h("div", { className: "pv-or" }, ["or"]));
    }
    children.push(pw, unlock);
    if (status.retryInMs > 0) children.push(h("p", { className: "pv-muted" }, [messageFor({ error: "wait", retryInMs: status.retryInMs })]));
    const form = h("form", {
      className: "pv-form pv-locked",
      onsubmit: function (ev) {
        ev.preventDefault();
        if (!pw.value) return;
        const value = pw.value;
        pw.value = "";
        act("unlock", { password: value });
      },
    }, children);
    setTimeout(function () { if (!status.helloReady) pw.focus(); }, 0);
    return form;
  }

  function header() {
    return h("div", { className: "pv-header" }, [
      h("span", { className: "pv-title" }, ["Vault"]),
      h("span", { className: "pv-muted pv-count" }, [entries.length === 1 ? "1 entry" : entries.length + " entries"]),
      h("span", { className: "pv-spacer" }),
      button("+ New", function () { openEditor(null); }, "pv-primary-small", "Add an entry"),
      button("⚙", function () { view = "settings"; flashMsg = null; render(); }, null, "Vault settings"),
      button("🔒", function () { act("lock"); }, null, "Lock now (Ctrl+Shift+L)"),
    ]);
  }

  function renderList() {
    const wrap = h("div", { className: "pv-list-view" }, [header()]);
    const search = h("input", {
      type: "search", className: "pv-input pv-search", placeholder: "Search the vault", value: query,
      oninput: function () { query = search.value; renderRows(); },
    });
    const folders = folderList(entries);
    const tools = h("div", { className: "pv-tools" }, [search]);
    if (folders.length) {
      const sel = h("select", {
        className: "pv-select", title: "Folder",
        onchange: function () { folder = sel.value; renderRows(); },
      }, [h("option", { value: "" }, ["All folders"])].concat(folders.map(function (f) {
        return h("option", { value: f }, [f]);
      })));
      if (folder && folders.indexOf(folder) === -1) folder = "";
      sel.value = folder;
      tools.appendChild(sel);
    } else folder = "";
    wrap.appendChild(tools);
    const fl = flashEl();
    if (fl) wrap.appendChild(fl);
    const list = h("div", { className: "pv-list", role: "list" });
    wrap.appendChild(list);

    function renderRows() {
      list.textContent = "";
      const shown = filterEntries(entries, query, folder);
      if (!entries.length) {
        list.appendChild(h("p", { className: "pv-empty" }, ["No entries yet. Press + New to add your first one."]));
        return;
      }
      if (!shown.length) {
        list.appendChild(h("p", { className: "pv-empty" }, ["Nothing matches."]));
        return;
      }
      shown.forEach(function (e) {
        const host = hostOf(e.url);
        list.appendChild(h("div", {
          className: "pv-row", role: "listitem", tabindex: "0", title: "Edit " + e.name,
          onclick: function () { openEditor(e.id); },
          onkeydown: function (ev) { if (ev.key === "Enter") openEditor(e.id); },
        }, [
          h("div", { className: "pv-row-main" }, [
            h("div", { className: "pv-row-name" }, [e.name]),
            h("div", { className: "pv-muted pv-row-sub" }, [[e.username, host].filter(Boolean).join(" · ") || " "]),
          ]),
          h("div", { className: "pv-row-actions" }, [
            e.username ? button("👤", function () { copy(e.id, "username"); }, null, "Copy username") : null,
            e.hasPassword ? button("🔑", function () { copy(e.id, "password"); }, null, "Copy password") : null,
            host ? button("↗", function () { openSite(e.id); }, null, "Open the site in a new tab") : null,
          ]),
        ]));
      });
    }
    renderRows();
    setTimeout(function () { if (document.activeElement === document.body) search.focus(); }, 0);
    return wrap;
  }

  async function copy(id, field) {
    const res = await call("copy", { id: id, field: field });
    if (!res.ok) {
      if (res.error === "locked") await refresh();
      return flash(messageFor(res), "error");
    }
    if (!res.copied) return flash("Nothing to copy.", "info");
    flash(field === "password"
      ? "Password copied." + (res.clearsIn ? " It's cleared from the clipboard in " + res.clearsIn + " seconds." : "")
      : "Username copied.", "ok");
  }

  async function openSite(id) {
    const res = await call("open-url", { id: id });
    if (res.ok && res.opened && api.browser && api.browser.newTab) api.browser.newTab(res.url, { activate: true });
    else if (!res.ok) flash(messageFor(res), "error");
  }

  async function openEditor(id) {
    generatorOpen = false;
    flashMsg = null;
    if (!id) {
      editing = { id: null, name: "", username: "", password: "", url: "", notes: "", folder: folder || "" };
      view = "edit";
      render();
      return;
    }
    const res = await call("get", { id: id });
    if (!res.ok) {
      if (res.error === "locked") await refresh();
      return flash(messageFor(res), "error");
    }
    editing = res.entry;
    view = "edit";
    render();
  }

  function field(label, input) {
    return h("label", { className: "pv-field" }, [h("span", { className: "pv-field-label" }, [label]), input]);
  }

  function renderEditor() {
    const e = editing;
    const name = h("input", { className: "pv-input", value: e.name, maxlength: "200", placeholder: "e.g. Contoso M365 admin" });
    const user = h("input", { className: "pv-input", value: e.username, maxlength: "500", autocomplete: "off", spellcheck: "false" });
    const pw = h("input", { type: "password", className: "pv-input pv-mono", value: e.password, maxlength: "1000", autocomplete: "off", spellcheck: "false" });
    const url = h("input", { className: "pv-input", value: e.url, maxlength: "2048", placeholder: "https://", spellcheck: "false" });
    const fold = h("input", { className: "pv-input", value: e.folder, maxlength: "100", list: "pv-folders", placeholder: "Optional" });
    const datalist = h("datalist", { id: "pv-folders" }, folderList(entries).map(function (f) { return h("option", { value: f }); }));
    const notes = h("textarea", { className: "pv-input pv-notes", maxlength: "10000", rows: "4" });
    notes.value = e.notes;

    function keep() {
      // So a re-render (generator, flash) doesn't lose what's typed.
      Object.assign(editing, { name: name.value, username: user.value, password: pw.value, url: url.value, folder: fold.value, notes: notes.value });
    }
    [name, user, pw, url, fold, notes].forEach(function (el) { el.addEventListener("input", keep); });

    const show = button("Show", function () {
      pw.type = pw.type === "password" ? "text" : "password";
      show.textContent = pw.type === "password" ? "Show" : "Hide";
    });
    const pwRow = h("div", { className: "pv-pw-row" }, [pw, show,
      button("Generate", function () { keep(); generatorOpen = !generatorOpen; render(); })]);

    const children = [
      h("div", { className: "pv-header" }, [
        h("span", { className: "pv-title" }, [e.id ? "Edit entry" : "New entry"]),
        h("span", { className: "pv-spacer" }),
        button("🔒", function () { act("lock"); }, null, "Lock now (Ctrl+Shift+L)"),
      ]),
    ];
    const fl = flashEl();
    if (fl) children.push(fl);
    const form = h("form", {
      className: "pv-form pv-edit",
      onsubmit: function (ev) {
        ev.preventDefault();
        keep();
        if (!editing.name.trim()) return flash(MESSAGES["bad-entry"], "error");
        const entry = Object.assign({}, editing);
        if (!entry.id) delete entry.id;
        act("save", { entry: entry }, function () {
          editing = null;
          view = "list";
          loadEntries();
        });
      },
    }, [
      field("Name", name),
      field("Username", user),
      field("Password", pwRow),
      generatorOpen ? renderGenerator(function (value) {
        pw.value = value;
        pw.type = "text";
        show.textContent = "Hide";
        keep();
      }) : null,
      field("Website", url),
      field("Folder", fold), datalist,
      field("Notes", notes),
      h("div", { className: "pv-actions" }, [
        h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, ["Save"]),
        h("button", {
          type: "button", className: "btn btn-secondary",
          onclick: function () { editing = null; generatorOpen = false; view = "list"; loadEntries(); },
        }, ["Cancel"]),
        h("span", { className: "pv-spacer" }),
        e.id ? h("button", {
          type: "button", className: "btn-small btn-delete",
          onclick: async function () {
            const ok = await api.ui.confirm("Delete \"" + e.name + "\" from the vault? This can't be undone.");
            if (!ok) return;
            act("delete", { id: e.id }, function () { editing = null; view = "list"; loadEntries(); });
          },
        }, ["Delete"]) : null,
      ]),
    ]);
    children.push(form);
    setTimeout(function () { if (!e.id) name.focus(); }, 0);
    return h("div", {}, children);
  }

  function renderGenerator(onUse) {
    const out = h("input", { className: "pv-input pv-mono", readonly: true, spellcheck: "false" });
    async function regen() {
      const res = await call("generate", { options: genOpts });
      if (res.ok) out.value = res.password;
    }
    function opt(key, label) {
      const cb = h("input", { type: "checkbox" });
      cb.checked = genOpts[key] !== false;
      cb.addEventListener("change", function () { genOpts[key] = cb.checked; regen(); });
      return h("label", { className: "pv-check" }, [cb, " " + label]);
    }
    const mode = h("select", { className: "pv-select" }, [
      h("option", { value: "chars" }, ["Characters"]),
      h("option", { value: "words" }, ["Words (passphrase)"]),
    ]);
    mode.value = genOpts.mode;
    mode.addEventListener("change", function () { genOpts.mode = mode.value; render(); });
    const isWords = genOpts.mode === "words";
    const range = h("input", {
      type: "range", min: isWords ? "3" : "8", max: isWords ? "10" : "64",
      value: String(isWords ? genOpts.words : genOpts.length),
    });
    const rangeLabel = h("span", { className: "pv-muted" }, [range.value + (isWords ? " words" : " characters")]);
    range.addEventListener("input", function () {
      const n = Number(range.value);
      if (isWords) genOpts.words = n; else genOpts.length = n;
      rangeLabel.textContent = n + (isWords ? " words" : " characters");
      regen();
    });
    regen();
    return h("div", { className: "pv-generator" }, [
      h("div", { className: "pv-pw-row" }, [out, button("↻", regen, null, "Another one"),
        button("Use", function () { if (out.value) { onUse(out.value); generatorOpen = false; render(); } }, "pv-primary-small")]),
      h("div", { className: "pv-gen-opts" }, [mode, range, rangeLabel]),
      isWords ? null : h("div", { className: "pv-gen-opts" }, [opt("lower", "a-z"), opt("upper", "A-Z"), opt("digits", "2-9"), opt("symbols", "!@#")]),
    ]);
  }

  function renderSettings() {
    const s = pendingSettings || status.settings;
    const children = [
      h("div", { className: "pv-header" }, [
        button("← Back", function () { view = "list"; pendingSettings = null; flashMsg = null; loadEntries(); }),
        h("span", { className: "pv-title" }, ["Vault settings"]),
        h("span", { className: "pv-spacer" }),
        button("🔒", function () { act("lock"); }, null, "Lock now (Ctrl+Shift+L)"),
      ]),
    ];
    const fl = flashEl();
    if (fl) children.push(fl);

    // --- Locking ---
    const reprompt = h("select", { className: "pv-select" }, REPROMPT_OPTIONS.map(function (o) {
      return h("option", { value: String(o[0]) }, [o[1]]);
    }));
    reprompt.value = String(s.repromptMinutes);
    const sleep = h("input", { type: "checkbox" });
    sleep.checked = s.lockOnSleep;
    const clip = h("select", { className: "pv-select" }, CLIPBOARD_OPTIONS.map(function (o) {
      return h("option", { value: String(o[0]) }, [o[1]]);
    }));
    clip.value = String(s.clipboardSeconds);
    const confirmPw = passwordInput("pv-settings-pw", "Master password (needed to make it less strict)", "current-password");
    children.push(h("form", {
      className: "pv-form pv-section",
      onsubmit: async function (ev) {
        ev.preventDefault();
        const chosen = { repromptMinutes: Number(reprompt.value), lockOnSleep: sleep.checked, clipboardSeconds: Number(clip.value) };
        pendingSettings = chosen;
        const res = await act("save-settings", { settings: chosen, password: confirmPw.value || undefined }, function () {
          pendingSettings = null;
          flash("Settings saved.", "ok");
        });
        if (res && !res.ok && (res.error === "password-required" || res.error === "wrong-password")) {
          const el = panel.querySelector("#pv-settings-pw");
          if (el) el.focus();
        } else if (res && !res.ok) pendingSettings = null;
      },
    }, [
      h("h4", { className: "pv-subtitle" }, ["Locking"]),
      h("p", { className: "pv-muted" }, ["MSP++ always asks for the master password when it starts. After that:"]),
      field("Ask for the password again", reprompt),
      h("label", { className: "pv-check" }, [sleep, " Ask again when Windows locks or the PC sleeps"]),
      field("Clear a copied password from the clipboard after", clip),
      confirmPw,
      h("div", { className: "pv-actions" }, [h("button", { type: "submit", className: "btn btn-primary", disabled: busy }, ["Save"])]),
    ]));

    // --- Windows Hello ---
    if (status.helloSupported || status.helloEnabled) {
      const helloPw = passwordInput("pv-hello-pw", "Master password", "current-password");
      children.push(h("form", {
        className: "pv-form pv-section",
        onsubmit: function (ev) {
          ev.preventDefault();
          if (status.helloEnabled) {
            act("disable-hello", {}, function () { flash("Windows Hello is off.", "ok"); });
          } else {
            const value = helloPw.value;
            helloPw.value = "";
            act("enable-hello", { password: value }, function () { flash("Windows Hello is on.", "ok"); });
          }
        },
      }, [
        h("h4", { className: "pv-subtitle" }, ["Windows Hello"]),
        h("p", { className: "pv-muted" }, [status.helloEnabled
          ? "On. When the vault asks again, your face, fingerprint or PIN can answer. It never replaces the master password when MSP++ starts."
          : "Let your face, fingerprint or PIN answer when the vault asks again. The vault's key is tied to Windows Hello, so only Windows Hello can open it. The master password is still needed every time MSP++ starts."]),
        status.helloEnabled ? null : helloPw,
        h("div", { className: "pv-actions" }, [h("button", {
          type: "submit", className: "btn " + (status.helloEnabled ? "btn-secondary" : "btn-primary"), disabled: busy,
        }, [status.helloEnabled ? "Turn off Windows Hello" : "Turn on Windows Hello"])]),
        busy && !status.helloEnabled ? h("p", { className: "pv-muted" }, ["Waiting for Windows Hello. If you don't see it, check behind the MSP++ window."]) : null,
      ]));
    }

    // --- Change master password ---
    const cur = passwordInput("pv-cur", "Current master password", "current-password");
    const next = passwordInput("pv-next", "New master password (at least " + MIN_PASSWORD + " characters)", "new-password");
    const next2 = passwordInput("pv-next2", "Type the new one again", "new-password");
    children.push(h("form", {
      className: "pv-form pv-section",
      onsubmit: function (ev) {
        ev.preventDefault();
        if (next.value !== next2.value) return flash("The new passwords don't match.", "error");
        act("change-password", { current: cur.value, next: next.value }, function () {
          cur.value = next.value = next2.value = "";
          flash("Master password changed. Encrypted copies you made before still open with the old one.", "ok");
        });
      },
    }, [
      h("h4", { className: "pv-subtitle" }, ["Change master password"]),
      cur, next, next2,
      h("div", { className: "pv-actions" }, [h("button", { type: "submit", className: "btn btn-secondary", disabled: busy }, ["Change password"])]),
    ]));

    // --- Backup ---
    children.push(h("div", { className: "pv-form pv-section" }, [
      h("h4", { className: "pv-subtitle" }, ["Encrypted copy"]),
      h("p", { className: "pv-muted" }, ["Saves the vault file, still encrypted, wherever you choose: a safe place in case this PC's copy is lost. It opens with the master password you have now."]),
      h("div", { className: "pv-actions" }, [button("Save an encrypted copy…", async function () {
        const res = await call("backup");
        if (!res.ok) return flash(messageFor(res), "error");
        if (res.saved) flash("Saved to " + res.path, "ok");
      })]),
    ]));

    // --- Delete ---
    const delPw = passwordInput("pv-del", "Master password", "current-password");
    children.push(h("form", {
      className: "pv-form pv-section pv-danger",
      onsubmit: async function (ev) {
        ev.preventDefault();
        const ok = await api.ui.confirm("Delete the whole vault and every entry in it? This can't be undone.");
        if (!ok) return;
        act("delete-vault", { password: delPw.value }, function () { flash("The vault was deleted.", "ok"); });
      },
    }, [
      h("h4", { className: "pv-subtitle" }, ["Delete the vault"]),
      h("p", { className: "pv-muted" }, ["Removes the vault file and its backup from this PC. Encrypted copies you saved elsewhere are not touched."]),
      delPw,
      h("div", { className: "pv-actions" }, [h("button", { type: "submit", className: "btn-small btn-delete", disabled: busy }, ["Delete vault"])]),
    ]));

    return h("div", {}, children);
  }

  function render() {
    // Keep focus in an input that is re-rendered only when nothing is typed there.
    panel.textContent = "";
    if (!status) {
      panel.appendChild(h("p", { className: "pv-empty" }, ["Loading…"]));
      return;
    }
    let content;
    if (status.state === "none") content = renderSetup();
    else if (status.state !== "unlocked") content = renderLocked();
    else if (view === "edit" && editing) content = renderEditor();
    else if (view === "settings") content = renderSettings();
    else content = renderList();
    if (status.state !== "unlocked") {
      const fl = flashEl();
      if (fl) panel.appendChild(fl);
    }
    panel.appendChild(content);
  }

  // ---------- Watching for locks ----------

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(refresh, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function repromptIfImmediate() {
    if (status && status.state === "unlocked" && status.settings && status.settings.repromptMinutes === 0) {
      call("reprompt-now").then(applyStatus);
    }
  }

  tab.onShow(function () {
    refresh();
    startPolling();
  });
  tab.onHide(function () {
    stopPolling();
    repromptIfImmediate();
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") repromptIfImmediate();
  });

  render();
  refresh();
})();
