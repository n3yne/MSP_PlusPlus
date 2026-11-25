"use strict";

// Password Vault plugin, main process. The vault key and the decrypted entries
// live only here (vault-session.js); the side panel tab gets what it shows and
// nothing more. Copying goes through here too, so a copied password never
// passes through the page.
//
// Locking:
//   - every app start: locked (nothing is kept between runs)
//   - re-prompt timer, Windows lock or sleep: re-prompt (Windows Hello or the
//     master password), or locked when Windows Hello is off
//   - Lock now, Ctrl+Shift+L, closing the app: locked
//
// Auto-fill (vault-fill.js) only happens when asked: a Fill button in the tab
// or Ctrl+Shift+F. The password goes from here straight into the page.

const path = require("path");
const { VaultSession, VaultError } = require("./vault-session");
const { generate, createClipboardGuard } = require("./vault-tools");
const Fill = require("./vault-fill");

const TICK_MS = 15000;
// The isolated world the fill script runs in (not the page's own world, 0,
// nor Electron's preload world, 999).
const FILL_WORLD = 4242;

// Errors the tab knows how to explain. Anything else is logged and shown as "failed".
const KNOWN_ERRORS = new Set([
  "locked", "no-vault", "exists", "wrong-password", "wait", "password-too-short", "password-too-long",
  "password-required", "bad-entry", "too-many", "not-found", "bad-field", "bad-file", "bad-version",
  "decrypt-failed", "hello-unavailable", "hello-cancelled", "hello-not-set-up", "hello-locked-out",
  "hello-busy", "hello-failed", "hello-mismatch",
  "fill-no-tab", "fill-wrong-site", "fill-not-https", "fill-no-fields",
]);

function errorResult(err, log) {
  const code = err && KNOWN_ERRORS.has(err.code) ? err.code : "failed";
  if (code === "failed" || code === "hello-failed") log("Password Vault:", err && err.message ? err.message : err);
  const res = { ok: false, error: code };
  if (err && err.retryInMs) res.retryInMs = err.retryInMs;
  return res;
}

function safeUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

module.exports = {
  init(api) {
    const electron = require("electron");
    const { app, clipboard, powerMonitor, dialog, BrowserWindow, webContents, Notification } = electron;
    // Windows Hello comes from the app (api.windowsHello, app 0.8.5+), which
    // keeps a Windows Hello key just for this plugin. Older apps: no Hello.
    const hello = api.windowsHello && process.platform === "win32" ? api.windowsHello : null;
    const session = new VaultSession({
      filePath: path.join(api.getDataPath(), "vault.json"),
      hello,
    });
    // Copies go through the app's private clipboard (app 0.8.9+), which keeps
    // them out of Windows clipboard history (Win+V) and cloud clipboard sync.
    // Clearing writes an empty string, which needs no privacy.
    const clip = createClipboardGuard({
      readText: () => clipboard.readText(),
      writeText: (t) => {
        if (t && api.clipboard && typeof api.clipboard.writePrivate === "function") api.clipboard.writePrivate(t);
        else clipboard.writeText(t);
      },
    });
    const ready = session.init().catch((e) => api.log("Password Vault: couldn't check for a vault:", e.message));
    let helloSupported = false;
    if (hello) hello.isSupported().then((v) => { helloSupported = v; }).catch(() => {});

    function status() {
      const s = session.status();
      s.ok = true;
      s.helloSupported = helloSupported;
      return s;
    }

    // Wraps a handler: waits for init, turns errors into { ok: false, error }.
    function handle(action, fn) {
      api.handle(action, async (data) => {
        await ready;
        try {
          const res = await fn(data && typeof data === "object" ? data : {});
          return Object.assign({ ok: true }, res || {});
        } catch (err) {
          return errorResult(err, api.log);
        }
      });
    }

    function onLockedOrReprompt() {
      // Nothing to copy any more: don't leave a password on the clipboard.
      clip.clearNow();
    }

    handle("status", async () => status());
    handle("create", async (d) => { await session.create(d.password); return status(); });
    handle("unlock", async (d) => { await session.unlock(d.password); return status(); });
    handle("unlock-hello", async () => { await session.unlockWithHello(); return status(); });
    handle("lock", async () => { session.lock(); onLockedOrReprompt(); return status(); });
    // "Re-prompt immediately": the tab calls this when it's hidden or the window is minimised.
    handle("reprompt-now", async () => {
      if (session.state === "unlocked" && session.status().settings.repromptMinutes === 0) {
        session.reprompt();
        onLockedOrReprompt();
      }
      return status();
    });

    handle("list", async () => ({ entries: session.listEntries() }));
    handle("get", async (d) => ({ entry: session.getEntry(d.id) }));
    handle("save", async (d) => session.saveEntry(d.entry));
    handle("delete", async (d) => session.deleteEntry(d.id));
    handle("copy", async (d) => {
      const field = d.field === "username" ? "username" : "password";
      const value = session.getField(d.id, field);
      if (!value) return { copied: false };
      const secs = field === "password" ? session.status().settings.clipboardSeconds : 0;
      clip.copy(value, secs);
      return { copied: true, clearsIn: secs };
    });
    handle("copy-generated", async (d) => {
      session.status(); // tick
      if (typeof d.text !== "string" || !d.text || d.text.length > 1000) return { copied: false };
      const secs = session.state === "unlocked" ? session.status().settings.clipboardSeconds : 30;
      clip.copy(d.text, secs);
      return { copied: true, clearsIn: secs };
    });
    handle("open-url", async (d) => {
      const url = safeUrl(session.getField(d.id, "url"));
      if (!url) return { opened: false };
      return { opened: true, url };
    });
    handle("generate", async (d) => ({ password: generate(d.options) }));

    // ---------- Auto-fill ----------

    // The page in the active browser tab, as the tab last told us.
    let activeTabId = null;
    api.onMessage("active-tab", (d) => {
      const id = d && Number(d.webContentsId);
      activeTabId = Number.isInteger(id) && id > 0 ? id : null;
    });
    const lastUsed = new Map(); // entry id → when it was last filled (this run only)
    let lastShortcut = null;    // { tabId, url, ids, index, at } for cycling with Ctrl+Shift+F

    // A browser tab's page. Only <webview> tabs, never MSP++'s own windows.
    function tabContents(id) {
      const wc = Number.isInteger(id) && id > 0 ? webContents.fromId(id) : null;
      if (!wc || wc.isDestroyed() || wc.getType() !== "webview") throw new VaultError("fill-no-tab");
      return wc;
    }

    function matchesFor(pageUrl) {
      return session.listEntries().filter((e) => Fill.siteMatches(e.url, pageUrl, e.match));
    }

    async function fillInto(wc, id) {
      const entry = session.getEntry(id);
      const pageUrl = wc.getURL();
      const page = Fill.parseSite(pageUrl);
      if (page && page.protocol !== "https:") throw new VaultError("fill-not-https");
      if (!Fill.siteMatches(entry.url, pageUrl, entry.match)) throw new VaultError("fill-wrong-site");
      const code = Fill.buildFillScript(Fill.originOf(pageUrl), entry.username, entry.password);
      const res = await wc.executeJavaScriptInIsolatedWorld(FILL_WORLD, [{ code }], true);
      if (!res || res.reason === "moved") throw new VaultError("fill-wrong-site");
      if (res.filled === "none") throw new VaultError("fill-no-fields");
      lastUsed.set(entry.id, Date.now());
      return { filled: res.filled, name: entry.name };
    }

    // Logins saved for a page (the tab's address), for the tab's "This page" list.
    handle("matching", async (d) => {
      const pageUrl = typeof d.url === "string" ? d.url : "";
      const list = Fill.orderMatches(matchesFor(pageUrl), lastUsed);
      return { matches: list.map((e) => ({ id: e.id, name: e.name, username: e.username })) };
    });
    handle("fill", async (d) => {
      const tabId = d.webContentsId === undefined ? activeTabId : Number(d.webContentsId);
      return fillInto(tabContents(tabId), d.id);
    });

    function tell(body) {
      try {
        if (Notification && Notification.isSupported()) new Notification({ title: "Password Vault", body, silent: true }).show();
      } catch {
        api.log("Password Vault:", body);
      }
    }

    const SHORTCUT_MESSAGES = {
      "locked": "The vault is locked. Unlock it in the 🔑 Vault tab, then press Ctrl+Shift+F again.",
      "no-vault": "There's no vault yet. Set one up in the 🔑 Vault tab.",
      "fill-no-tab": "Open the sign-in page in a tab first.",
      "fill-not-https": "Auto-fill only works on https:// pages.",
      "fill-wrong-site": "The page changed before it could be filled. Try again.",
      "fill-no-fields": "Couldn't find a sign-in box on this page.",
    };

    // Ctrl+Shift+F: fills the active tab with its best match; again within
    // 10 seconds on the same page fills the next match.
    async function fillActiveTab() {
      await ready;
      try {
        const wc = tabContents(activeTabId);
        const pageUrl = wc.getURL();
        const page = Fill.parseSite(pageUrl);
        if (page && page.protocol !== "https:") throw new VaultError("fill-not-https");
        const matches = matchesFor(pageUrl);
        if (!matches.length) {
          tell("No saved login for " + (page ? page.host : "this page") + ". Add one in the 🔑 Vault tab with this site as its website.");
          return;
        }
        const now = Date.now();
        let pick;
        const ids = matches.map((e) => e.id).sort().join(",");
        if (lastShortcut && lastShortcut.tabId === activeTabId && lastShortcut.url === pageUrl &&
            lastShortcut.ids === ids && now - lastShortcut.at < Fill.CYCLE_MS) {
          lastShortcut.index = (lastShortcut.index + 1) % lastShortcut.order.length;
          pick = lastShortcut.order[lastShortcut.index];
          lastShortcut.at = now;
        } else {
          const order = Fill.orderMatches(matches, lastUsed).map((e) => e.id);
          lastShortcut = { tabId: activeTabId, url: pageUrl, ids, order, index: 0, at: now };
          pick = order[0];
        }
        const res = await fillInto(wc, pick);
        if (matches.length > 1) tell("Filled " + res.name + ". Press Ctrl+Shift+F again for the next login for this site.");
      } catch (err) {
        const code = err && err.code;
        if (SHORTCUT_MESSAGES[code]) tell(SHORTCUT_MESSAGES[code]);
        else errorResult(err, api.log);
      }
    }

    handle("save-settings", async (d) => { await session.saveSettings(d.settings, d.password); return status(); });
    handle("enable-hello", async (d) => {
      if (!helloSupported) throw new VaultError("hello-unavailable");
      await session.enableHello(d.password);
      return status();
    });
    handle("disable-hello", async () => {
      await session.disableHello();
      if (hello) hello.remove();
      return status();
    });
    handle("change-password", async (d) => {
      const res = await session.changePassword(d.current, d.next);
      // Windows Hello wrapped the old vault key, so it was turned off: drop its key too.
      if (res && res.helloTurnedOff && hello) hello.remove();
      return Object.assign(status(), { helloTurnedOff: !!(res && res.helloTurnedOff) });
    });
    handle("backup", async () => {
      session.listEntries(); // throws when locked, before any dialog
      const win = BrowserWindow.getFocusedWindow();
      const stamp = new Date().toISOString().slice(0, 10);
      const res = await dialog.showSaveDialog(win, {
        title: "Save an encrypted copy of the vault",
        defaultPath: path.join(app.getPath("documents"), "msp-pp-vault-" + stamp + ".json"),
        filters: [{ name: "Vault file", extensions: ["json"] }],
      });
      if (res.canceled || !res.filePath) return { saved: false };
      await session.backupTo(res.filePath);
      return { saved: true, path: res.filePath };
    });
    handle("delete-vault", async (d) => {
      await session.deleteVault(d.password);
      onLockedOrReprompt();
      if (hello) hello.remove();
      return status();
    });

    // The re-prompt timer. Also checked on every request, so a PC that slept
    // through a tick still asks again on the next click.
    const timer = setInterval(() => {
      const before = session.state;
      session.tick();
      if (before === "unlocked" && session.state !== "unlocked") onLockedOrReprompt();
    }, TICK_MS);
    if (timer.unref) timer.unref();

    function onSystemLock() {
      if (session.state !== "unlocked") return;
      if (!session.status().settings.lockOnSleep) return;
      session.reprompt();
      onLockedOrReprompt();
    }
    try {
      powerMonitor.on("lock-screen", onSystemLock);
      powerMonitor.on("suspend", onSystemLock);
    } catch (e) {
      api.log("Password Vault: can't watch for Windows lock/sleep:", e.message);
    }

    api.addMenuItem({
      label: "Fill Login from Password Vault",
      accelerator: "CmdOrCtrl+Shift+F",
      click: () => { fillActiveTab(); },
    });
    api.addMenuItem({
      label: "Lock Password Vault",
      accelerator: "CmdOrCtrl+Shift+L",
      click: () => { session.lock(); onLockedOrReprompt(); },
    });

    app.on("before-quit", () => {
      session.lock();
      clip.clearNow();
    });
  },
};
