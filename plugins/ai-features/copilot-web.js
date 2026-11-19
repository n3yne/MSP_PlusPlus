"use strict";

// "Copilot (website)" provider: uses a chat website, Microsoft Copilot Chat by
// default, signed in inside MSP++, instead of an API. No app registration or
// API key is needed; free Copilot Chat comes with a Microsoft work account.
//
// The site opens in a small "Copilot" window of its own (a bar at the top, the
// site below it in its own saved session). For each request MSP++ loads a new
// chat, types the prompt into the site's message box and then either:
//   - one-click (default): waits for the user to press Send and click
//     "Use this reply", which reads the reply back, or
//   - hands-off ("Send automatically", experimental, off by default): presses
//     Send itself in a hidden window and reads the reply when it stops changing.
// When MSP++ can't find the message box or the reply (for example after the
// site is redesigned), it falls back to copy and paste: the prompt goes on the
// clipboard, and "Use this reply" reads the selected text or the clipboard.
//
// Microsoft's terms forbid automated extraction from its AI services, which is
// why one-click is the default and every prompt is one the user asked for.

const path = require("path");

const PARTITION = "persist:msp-copilot-web";
const BAR_HEIGHT = 46;
const ACTION_PREFIX = "https://msp-copilot.invalid/";
const PAGE_LOAD_TIMEOUT_MS = 45000;
const ONE_CLICK_TIMEOUT_MS = 15 * 60 * 1000;
const AUTO_REPLY_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_MS = 700;
// The reply counts as finished once its text hasn't changed for this long and
// no "Stop" button is showing.
const STABLE_MS = 2500;

// Where each site lives and how long a prompt it takes. Copilot's limits are
// what its message box accepts today; a longer request is trimmed by the caller
// or refused with a clear message.
const SITES = {
  "copilot-work": {
    label: "Microsoft Copilot (work account)",
    url: "https://m365.cloud.microsoft/chat",
    maxPromptChars: 16000,
  },
  "copilot-consumer": {
    label: "Microsoft Copilot (copilot.microsoft.com)",
    url: "https://copilot.microsoft.com/",
    maxPromptChars: 10000,
  },
  custom: {
    label: "Other chat site",
    url: "",
    maxPromptChars: 30000,
  },
};

// How to find things on the page. Copilot-specific selectors come first, then
// generic ones that fit most chat sites. These are best guesses at the live
// pages and are the part most likely to need updating after a redesign; the
// copy-and-paste fallback keeps things working meanwhile.
const SELECTORS = {
  input: [
    "#m365-chat-editor-target-element",
    "textarea#userInput",
    "[data-testid=\"chat-input\"] [contenteditable=\"true\"]",
    "#prompt-textarea",
    "[contenteditable=\"true\"][role=\"textbox\"]",
    "textarea",
    "div[contenteditable=\"true\"]",
  ],
  send: [
    "button[data-testid=\"submit-button\"]",
    "button[data-testid=\"send-button\"]",
    "button[aria-label=\"Send\"]",
    "button[title=\"Send\"]",
    "button[type=\"submit\"]",
  ],
  reply: [
    "[data-testid=\"copilot-message-reply-div\"]",
    "[data-testid=\"markdown-reply\"]",
    "[data-content=\"ai-message\"]",
    "[data-message-author-role=\"assistant\"]",
    "[data-author=\"bot\"]",
    "[class*=\"ai-message\"]",
    "[class*=\"assistant-message\"]",
  ],
};

function siteFor(settings) {
  const key = settings && SITES[settings.aiWebSite] ? settings.aiWebSite : "copilot-work";
  const site = Object.assign({ key }, SITES[key]);
  if (key === "custom") site.url = normalizeSiteUrl(settings && settings.aiWebUrl) || "";
  return site;
}

// Returns the https URL as typed (trimmed), or null if it isn't an https URL.
function normalizeSiteUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

function isHttps(url) {
  try { return new URL(url).protocol === "https:"; } catch { return false; }
}

// ===================== In-page script =====================

// Runs inside the chat site's page (webContents.executeJavaScript). Kept free of
// outside references so it can be serialised with toString().
//   "probe": what's on the page: message box, reply count, last reply, busy
//   "focus": focuses the message box and selects its contents, so typed text replaces them
//   "send":  clicks the Send button
//   "selection": the text the user has selected
/* global document, window */
function pageAction(action, sel) {
  function shown(el) {
    return !!el && el.getClientRects().length > 0;
  }
  function firstShown(selectors) {
    for (const s of selectors) {
      let list;
      try { list = document.querySelectorAll(s); } catch { continue; }
      for (const el of list) if (shown(el) && !el.disabled && !el.readOnly) return el;
    }
    return null;
  }
  function labelOf(el) {
    return ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("title") || "")).toLowerCase();
  }
  function buttons() {
    return Array.from(document.querySelectorAll("button")).filter(shown);
  }
  function inputText(el) {
    if (!el) return "";
    return String(el.value !== undefined && (el.tagName === "TEXTAREA" || el.tagName === "INPUT") ? el.value : el.innerText || "");
  }
  // The replies found by the first reply selector that matches anything, so
  // two selectors never count the same message twice.
  function replies() {
    for (const s of sel.reply) {
      let list;
      try { list = Array.from(document.querySelectorAll(s)).filter(shown); } catch { continue; }
      if (list.length) return list;
    }
    return [];
  }

  if (action === "probe") {
    const input = firstShown(sel.input);
    const list = replies();
    const last = list.length ? String(list[list.length - 1].innerText || "").trim() : "";
    const busy = buttons().some(function (b) { return /\bstop\b/.test(labelOf(b)); });
    return { hasInput: !!input, inputLength: inputText(input).trim().length, replyCount: list.length, lastReply: last, busy };
  }

  if (action === "focus") {
    const input = firstShown(sel.input);
    if (!input) return false;
    input.focus();
    if (typeof input.setSelectionRange === "function" && input.value !== undefined) {
      input.setSelectionRange(0, String(input.value).length);
    } else {
      document.execCommand("selectAll");
    }
    return true;
  }

  if (action === "send") {
    let btn = firstShown(sel.send);
    if (!btn) {
      btn = buttons().find(function (b) {
        const label = labelOf(b);
        return !b.disabled && /\bsend\b|\bsubmit\b/.test(label) && !/\bstop\b/.test(label);
      }) || null;
    }
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  }

  if (action === "selection") {
    const s = window.getSelection && window.getSelection();
    return s && typeof s.toString === "function" ? String(s.toString()).trim() : "";
  }

  return null;
}

function pageScript(action) {
  return "(" + pageAction.toString() + ")(" + JSON.stringify(action) + ", " + JSON.stringify(SELECTORS) + ")";
}

// True once a new reply has appeared since `base` and finished: text present,
// no Stop button, and the same text as the previous probe for STABLE_MS.
function replyFinished(base, probe, stableSince, now) {
  if (!probe || probe.busy) return false;
  const isNew = probe.replyCount > base.replyCount ||
    (probe.replyCount === base.replyCount && probe.replyCount > 0 && probe.lastReply !== base.lastReply);
  if (!isNew || !probe.lastReply) return false;
  return stableSince !== null && now - stableSince >= STABLE_MS;
}

// Picks the text "Use this reply" hands back: what the user selected, else the
// newest reply found on the page, else the clipboard if it changed since the
// request started (the user clicked the site's Copy button). The prompt itself
// is never taken as a reply.
function pickReply({ selection, probe, base, clipboard, clipboardAtStart, prompt }) {
  const notPrompt = (t) => t && t.trim() && t.trim() !== String(prompt || "").trim();
  if (notPrompt(selection)) return selection.trim();
  if (probe && probe.lastReply && (probe.replyCount > base.replyCount || probe.lastReply !== base.lastReply) && notPrompt(probe.lastReply)) {
    return probe.lastReply.trim();
  }
  if (notPrompt(clipboard) && clipboard !== clipboardAtStart) return clipboard.trim();
  return "";
}

// ===================== Window and requests =====================

function createCopilotWeb(api, deps) {
  const electron = (deps && deps.electron) || require("electron");
  const now = (deps && deps.now) || Date.now;
  const sleep = (deps && deps.sleep) || ((ms) => new Promise((r) => setTimeout(r, ms)));

  let win = null;
  let view = null;
  let pending = null;      // the request waiting on the window
  let closeWatchSet = false;

  function chromeUserAgent() {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
      process.versions.chrome + " Safari/537.36";
  }

  function alive() {
    return !!(win && !win.isDestroyed() && view && !view.webContents.isDestroyed());
  }

  // Our window must not keep the app running once every other window is closed
  // (the app quits on window-all-closed), so it closes with the last of them.
  function watchOtherWindows() {
    if (closeWatchSet || !electron.app || !electron.app.on) return;
    closeWatchSet = true;
    const check = () => {
      if (!win || win.isDestroyed()) return;
      const others = electron.BrowserWindow.getAllWindows()
        .filter((w) => w !== win && !w.isDestroyed() && (!w.getParentWindow || w.getParentWindow() !== win));
      if (!others.length) win.destroy();
    };
    const watch = (w) => { if (w !== win) w.on("closed", () => setTimeout(check, 0)); };
    electron.BrowserWindow.getAllWindows().forEach(watch);
    electron.app.on("browser-window-created", (e, w) => watch(w));
    electron.app.on("before-quit", () => { if (win && !win.isDestroyed()) win.destroy(); });
  }

  function layout() {
    if (!alive()) return;
    const [w, h] = win.getContentSize();
    view.setBounds({ x: 0, y: BAR_HEIGHT, width: w, height: Math.max(0, h - BAR_HEIGHT) });
  }

  function ensureWindow() {
    if (alive()) return;
    const { BrowserWindow, WebContentsView, session } = electron;
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(chromeUserAgent());
    // The site may copy to the clipboard; nothing else (camera, location...).
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === "clipboard-sanitized-write"));

    win = new BrowserWindow({
      width: 560,
      height: 820,
      minWidth: 380,
      minHeight: 400,
      show: false,
      title: "Copilot - MSP++",
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    // The bar is a local page. Its buttons are links to ACTION_PREFIX, caught here,
    // so the bar needs no preload or IPC.
    win.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      if (typeof url === "string" && url.startsWith(ACTION_PREFIX)) onBarAction(url.slice(ACTION_PREFIX.length));
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadFile(path.join(__dirname, "copilot-bar.html")).catch(() => {});

    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Hands-off mode runs hidden; keep timers and rendering going.
        backgroundThrottling: false,
      },
    });
    win.contentView.addChildView(view);
    view.webContents.setUserAgent(chromeUserAgent());
    // Microsoft sign-in can open pop-ups; they share this session and close with the window.
    view.webContents.setWindowOpenHandler(({ url }) => (isHttps(url)
      ? {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: win,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      }
      : { action: "deny" }));
    view.webContents.on("will-navigate", (event, url) => { if (!isHttps(url)) event.preventDefault(); });

    win.on("resize", layout);
    win.on("closed", () => {
      win = null;
      view = null;
      finishPending(new Error("Cancelled: the Copilot window was closed."));
    });
    layout();
    watchOtherWindows();
  }

  function setBar(state) {
    if (!win || win.isDestroyed()) return;
    const run = () => win.webContents.executeJavaScript("window.setBar && window.setBar(" + JSON.stringify(state) + ")").catch(() => {});
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", run); else run();
  }

  function show() {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  async function page(action) {
    if (!alive()) return null;
    try {
      return await view.webContents.executeJavaScript(pageScript(action));
    } catch {
      return null;
    }
  }

  // Loads the site (a fresh chat every time, so one ticket's details never carry
  // into the next request) and waits until the message box shows up.
  async function loadSite(site, timeoutMs) {
    view.webContents.loadURL(site.url).catch(() => { /* redirects to sign-in abort the first load */ });
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (!alive()) return false;
      await sleep(POLL_MS);
      const p = await page("probe");
      if (p && p.hasInput) return true;
    }
    return false;
  }

  function finishPending(err, text) {
    const p = pending;
    if (!p) return;
    pending = null;
    if (p.timer) clearTimeout(p.timer);
    if (err) p.reject(err); else p.resolve(text);
  }

  // Types the prompt into the message box. Returns true if the box now holds it.
  async function typePrompt(prompt) {
    if (!(await page("focus"))) return false;
    view.webContents.insertText(prompt);
    await sleep(200);
    const p = await page("probe");
    return !!(p && p.inputLength > 0);
  }

  function copyPrompt(prompt) {
    try { electron.clipboard.writeText(prompt); } catch { /* clipboard unavailable */ }
  }

  function readClipboard() {
    try { return electron.clipboard.readText() || ""; } catch { return ""; }
  }

  // Waits for a new reply to finish and returns its text, or "" on timeout.
  async function waitForReply(req, timeoutMs) {
    const deadline = now() + timeoutMs;
    let lastText = null;
    let stableSince = null;
    while (now() < deadline && pending === req) {
      await sleep(POLL_MS);
      const p = await page("probe");
      if (!p) continue;
      if (p.lastReply !== lastText) { lastText = p.lastReply; stableSince = now(); }
      if (replyFinished(req.base, p, stableSince, now())) return p.lastReply.trim();
    }
    return "";
  }

  function oneClickBar(req, fallback) {
    req.fallback = fallback;
    setBar(fallback
      ? {
        mode: "fallback",
        text: "Couldn't fill in the message box. The request is on your clipboard: click the message box, " +
          "paste (Ctrl+V), press Send, then click Use this reply.",
      }
      : { mode: "waiting", text: "Check the request, press Send in Copilot, then click Use this reply once it has finished." });
  }

  async function onBarAction(action) {
    const req = pending;
    if (action === "cancel") {
      finishPending(new Error("Cancelled in the Copilot window."));
      if (win && !win.isDestroyed()) win.hide();
      return;
    }
    if (action === "hide") {
      if (win && !win.isDestroyed()) win.hide();
      return;
    }
    if (!req) return;
    if (action === "copy") {
      copyPrompt(req.prompt);
      setBar({ mode: req.fallback ? "fallback" : "waiting", text: "Request copied. Paste it into Copilot (Ctrl+V) if it isn't there already." });
      return;
    }
    if (action === "use") {
      const text = pickReply({
        selection: await page("selection"),
        probe: await page("probe"),
        base: req.base,
        clipboard: readClipboard(),
        clipboardAtStart: req.clipboardAtStart,
        prompt: req.prompt,
      });
      if (!text) {
        setBar({
          mode: req.fallback ? "fallback" : "waiting",
          text: "Couldn't find a reply yet. Wait for Copilot to finish, or select the reply (or click its Copy button), then click Use this reply again.",
        });
        return;
      }
      finishPending(null, text);
      setBar({ mode: "idle", text: "Reply sent to MSP++." });
      if (win && !win.isDestroyed()) win.hide();
      if (req.returnTo && !req.returnTo.isDestroyed()) req.returnTo.focus();
    }
  }

  // Runs one prompt through the site. Resolves with the reply text.
  async function chat(prompt, settings) {
    const site = siteFor(settings);
    if (!site.url) throw new Error("Enter the chat site's address in Settings → AI Features.");
    if (prompt.length > site.maxPromptChars) {
      throw new Error(`This request is ${prompt.length.toLocaleString("en-US")} characters, more than ${site.label} accepts ` +
        `(${site.maxPromptChars.toLocaleString("en-US")}). Shorten the notes and try again.`);
    }
    // A newer request replaces one still waiting in the window.
    finishPending(new Error("Replaced by a newer AI request."));

    const autoSend = settings && settings.aiWebAutoSend === true;
    const returnTo = electron.BrowserWindow.getFocusedWindow && electron.BrowserWindow.getFocusedWindow();
    ensureWindow();

    let resolve;
    let reject;
    const done = new Promise((res, rej) => { resolve = res; reject = rej; });
    const req = { prompt, resolve, reject, returnTo, base: { replyCount: 0, lastReply: "" }, clipboardAtStart: readClipboard(), fallback: false };
    pending = req;
    req.timer = setTimeout(() => {
      if (pending === req) finishPending(new Error("Copilot didn't reply in time. Try again."));
    }, autoSend ? PAGE_LOAD_TIMEOUT_MS + AUTO_REPLY_TIMEOUT_MS + 30000 : ONE_CLICK_TIMEOUT_MS);
    if (req.timer && req.timer.unref) req.timer.unref();

    setBar({ mode: "working", text: "Opening a new chat…" });
    if (!autoSend) show();

    (async () => {
      const ready = await loadSite(site, PAGE_LOAD_TIMEOUT_MS);
      if (pending !== req) return;
      if (ready) {
        req.base = (await page("probe")) || req.base;
      }
      const typed = ready && (await typePrompt(prompt));
      if (pending !== req) return;

      if (autoSend && typed && (await page("send"))) {
        setBar({ mode: "working", text: "Sent automatically. Waiting for the reply…" });
        const text = await waitForReply(req, AUTO_REPLY_TIMEOUT_MS);
        if (pending !== req) return;
        if (text) {
          finishPending(null, text);
          setBar({ mode: "idle", text: "Reply sent to MSP++." });
          return;
        }
        // Couldn't read the reply: hand over to the user instead of failing.
        oneClickBar(req, false);
        setBar({ mode: "waiting", text: "Couldn't read the reply automatically. When Copilot has finished, click Use this reply." });
        show();
        return;
      }

      if (!typed) copyPrompt(prompt);
      oneClickBar(req, !typed);
      if (autoSend) {
        // Hands-off couldn't send (signed out, or the page changed): finish here.
        setBar({
          mode: typed ? "waiting" : "fallback",
          text: (ready ? "Couldn't send automatically. " : "Copilot didn't load (are you signed in?). Sign in if asked, then ") +
            (typed ? "Press Send, then click Use this reply." : "paste the request from your clipboard (Ctrl+V), press Send, then click Use this reply."),
        });
        show();
      }
    })().catch((err) => {
      api.log("Copilot website request failed:", err && err.message ? err.message : String(err));
      if (pending === req) {
        copyPrompt(prompt);
        oneClickBar(req, true);
        show();
      }
    });

    return done;
  }

  // Opens the site so the user can sign in.
  function open(settings) {
    const site = siteFor(settings);
    if (!site.url) return { error: "Enter the chat site's address first." };
    ensureWindow();
    if (!pending) setBar({ mode: "idle", text: "Sign in here if asked. MSP++ keeps you signed in. Close this window when you're done." });
    view.webContents.loadURL(site.url).catch(() => {});
    show();
    return { ok: true };
  }

  // Forgets the site's sign-in (cookies and storage of the Copilot session).
  async function signOut() {
    finishPending(new Error("Signed out of the chat site."));
    if (win && !win.isDestroyed()) win.destroy();
    try {
      await electron.session.fromPartition(PARTITION).clearStorageData();
    } catch (err) {
      api.log("Could not clear the chat site's session:", err.message);
    }
    return { ok: true };
  }

  return { chat, open, signOut, siteFor, _onBarAction: onBarAction, _pending: () => pending };
}

module.exports = {
  createCopilotWeb,
  siteFor,
  normalizeSiteUrl,
  pageAction,
  pageScript,
  replyFinished,
  pickReply,
  SITES,
  SELECTORS,
  PARTITION,
  STABLE_MS,
};
