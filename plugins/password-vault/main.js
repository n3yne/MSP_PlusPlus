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

const path = require("path");
const { VaultSession, VaultError } = require("./vault-session");
const { generate, createClipboardGuard } = require("./vault-tools");
const { createWindowsHello } = require("./windows-hello");

const TICK_MS = 15000;

// Errors the tab knows how to explain. Anything else is logged and shown as "failed".
const KNOWN_ERRORS = new Set([
  "locked", "no-vault", "exists", "wrong-password", "wait", "password-too-short", "password-too-long",
  "password-required", "bad-entry", "too-many", "not-found", "bad-field", "bad-file", "bad-version",
  "decrypt-failed", "hello-unavailable", "hello-cancelled", "hello-not-set-up", "hello-locked-out",
  "hello-timeout", "hello-busy", "hello-failed", "hello-mismatch",
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
    const { app, clipboard, powerMonitor, dialog, BrowserWindow } = electron;
    const hello = process.platform === "win32" ? createWindowsHello() : null;
    const session = new VaultSession({
      filePath: path.join(api.getDataPath(), "vault.json"),
      hello,
    });
    const clip = createClipboardGuard(clipboard);
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
    handle("change-password", async (d) => { await session.changePassword(d.current, d.next); return status(); });
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
