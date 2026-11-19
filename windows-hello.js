"use strict";

// Windows Hello for plugins (api.windowsHello, app 0.8.5+).
//
// Wraps the native addon in native/windows-hello (Windows' KeyCredentialManager).
// Each plugin gets its own Windows Hello key, named "MSP++ <plugin id>", so one
// plugin can't use another's. The key never leaves Windows; a plugin can only
// ask it to sign a challenge, and Windows asks for face, fingerprint or PIN
// first. Because the signature (RSA PKCS#1 v1.5) is the same every time for the
// same challenge, a plugin can derive an encryption key from it that only
// Windows Hello can recreate (Password Vault does this).
//
// Errors carry a code: hello-unavailable, hello-cancelled, hello-not-set-up,
// hello-locked-out, hello-busy, hello-failed.

const CREDENTIAL_PREFIX = "MSP++ ";

class HelloError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// KeyCredentialStatus name → error code.
function statusToCode(status) {
  switch (status) {
    case "UserCanceled":
    case "UserPrefersPassword":
      return "hello-cancelled";
    case "NotFound":
      return "hello-not-set-up";
    case "SecurityDeviceLocked":
      return "hello-locked-out";
    default:
      return "hello-failed";
  }
}

function credentialName(pluginId) {
  return CREDENTIAL_PREFIX + String(pluginId);
}

// loader (for tests): () => ({ available, native, loadError })
function createWindowsHello(options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const load = o.loader || (() => require("./native/windows-hello"));
  let mod = null;
  let supported = null;
  let busy = false;

  function getNative() {
    if (platform !== "win32") return null;
    if (!mod) {
      try {
        mod = load();
      } catch (e) {
        mod = { available: false, loadError: e };
      }
      if (!mod.available && mod.loadError) console.warn("[WindowsHello] Not available:", mod.loadError.message || mod.loadError);
    }
    return mod.available ? mod.native : null;
  }

  async function isSupported() {
    if (supported !== null) return supported;
    const native = getNative();
    if (!native) return (supported = false);
    try {
      supported = !!(await native.isSupported());
    } catch (e) {
      console.warn("[WindowsHello] isSupported failed:", e.message);
      supported = false;
    }
    return supported;
  }

  // Signs `challenge` with the plugin's Windows Hello key; Windows asks the
  // person first. opts.create makes the key if the plugin has none yet.
  // Resolves to the signature (a Buffer the caller should wipe).
  async function sign(pluginId, challenge, opts) {
    const native = getNative();
    if (!native) throw new HelloError("hello-unavailable");
    if (!Buffer.isBuffer(challenge) || challenge.length < 16 || challenge.length > 1024) {
      throw new HelloError("hello-failed", "The challenge must be a Buffer of 16-1024 bytes");
    }
    if (busy) throw new HelloError("hello-busy");
    busy = true;
    try {
      let res;
      try {
        res = await native.sign(credentialName(pluginId), challenge, !!(opts && opts.create));
      } catch (e) {
        throw new HelloError("hello-failed", e && e.message);
      }
      if (!res || res.status !== "Success") throw new HelloError(statusToCode(res && res.status), res && res.status);
      if (!Buffer.isBuffer(res.signature) || res.signature.length < 64) throw new HelloError("hello-failed", "No signature");
      return res.signature;
    } finally {
      busy = false;
    }
  }

  // Deletes the plugin's Windows Hello key. Best effort.
  async function remove(pluginId) {
    const native = getNative();
    if (!native) return;
    try {
      await native.remove(credentialName(pluginId));
    } catch (e) {
      console.warn("[WindowsHello] remove failed:", e.message);
    }
  }

  // The object a plugin sees as api.windowsHello, bound to its id.
  function forPlugin(pluginId) {
    return Object.freeze({
      isSupported: () => isSupported(),
      sign: (challenge, opts) => sign(pluginId, challenge, opts),
      remove: () => remove(pluginId),
    });
  }

  return { isSupported, sign, remove, forPlugin };
}

let shared = null;
function getShared() {
  if (!shared) shared = createWindowsHello();
  return shared;
}

module.exports = { createWindowsHello, getShared, statusToCode, credentialName, HelloError, CREDENTIAL_PREFIX };
