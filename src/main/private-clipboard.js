"use strict";

// Private clipboard for plugins (api.clipboard, app 0.8.9+).
//
// writePrivate(text) copies text that Windows keeps out of clipboard history
// (Win+V) and cloud clipboard sync, the way password managers do, through the
// native addon in native/windows-clipboard. Where that isn't possible (not
// Windows, the addon didn't load, or Windows refused) it copies normally with
// Electron's clipboard. Returns true when the copy was private.

// loader (for tests): () => ({ available, native, loadError });
// clipboard (for tests): { writeText(s) }
function createPrivateClipboard(options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const load = o.loader || (() => require("../../native/windows-clipboard"));
  const fallback = o.clipboard || null;
  let mod = null;

  function getNative() {
    if (platform !== "win32") return null;
    if (!mod) {
      try {
        mod = load();
      } catch (e) {
        mod = { available: false, loadError: e };
      }
      if (!mod.available && mod.loadError) console.warn("[PrivateClipboard] Not available:", mod.loadError.message || mod.loadError);
    }
    return mod.available ? mod.native : null;
  }

  function plainClipboard() {
    return fallback || require("electron").clipboard;
  }

  function writePrivate(text) {
    const s = String(text == null ? "" : text);
    const native = getNative();
    if (native && s) {
      try {
        if (native.writeTextPrivate(s) === true) return true;
      } catch (e) {
        console.warn("[PrivateClipboard] Private copy failed, copying normally:", e && e.message);
      }
    }
    plainClipboard().writeText(s);
    return false;
  }

  function isSupported() {
    return !!getNative();
  }

  return Object.freeze({ writePrivate, isSupported });
}

let shared = null;
function getShared() {
  if (!shared) shared = createPrivateClipboard();
  return shared;
}

module.exports = { createPrivateClipboard, getShared };
