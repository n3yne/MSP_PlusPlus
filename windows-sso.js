"use strict";

// Windows device sign-on for Microsoft sign-in pages (api.windowsSso, app 0.8.6+).
//
// On a PC registered with Microsoft Entra ID, Windows can vouch for the device
// when you sign in to Microsoft: Edge, Chrome (CloudAPAuth policy or the
// "Windows Accounts" extension) and Firefox ("Allow Windows single sign-on")
// ask Windows for short-lived signed proofs and send them to
// login.microsoftonline.com as x-ms-RefreshTokenCredential headers, so
// Conditional Access sees a known, compliant device. Electron doesn't, so a
// "compliant device" policy blocks sign-in inside MSP++ (error 53000).
//
// This does the same thing as those browsers, through the native addon in
// native/windows-sso (Windows' IProofOfPossessionCookieInfoManager). The proofs
// are signed by Windows with the PC's TPM-bound token, so they only exist on a
// PC the organisation already trusts; on any other PC there is nothing to send.
//
// The proofs are credentials, so:
//   - they're only ever added to requests for the exact Microsoft login hosts
//     below, over https (never a substring match: CVE-2019-1172 was a browser
//     extension leaking them to look-alike URLs),
//   - only on page loads (main frame or frame), fresh for each request,
//   - plugins never see them: a plugin can only turn the headers on or off for
//     one of its own "persist:" sessions and ask whether a proof is available.

const LOGIN_HOSTS = ["login.microsoftonline.com", "login.microsoft.com"];
const HEADER_NAME = /^x-ms-(?:RefreshTokenCredential|DeviceCredential)\d{0,2}$/i;
// Visible ASCII only: nothing that could end the header early.
const HEADER_VALUE = /^[\x21-\x7e]{1,16384}$/;
const PARTITION_PATTERN = /^persist:[A-Za-z0-9._-]{1,64}$/;
const AVAILABLE_CACHE_MS = 60 * 1000;
const PAGE_LOADS = new Set(["mainFrame", "subFrame"]);

// True for an https URL on one of LOGIN_HOSTS (exact host, default port).
function isLoginUrl(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password) return false;
  return LOGIN_HOSTS.includes(u.hostname.toLowerCase());
}

// Turns GetCookieInfoForUri's entries into request headers. Each entry's data
// is a cookie string ("<value>; path=/; domain=...; secure; httponly"); the
// header carries the value only.
function headersFromCookies(cookies) {
  const out = {};
  for (const c of Array.isArray(cookies) ? cookies : []) {
    if (!c || typeof c.name !== "string" || typeof c.data !== "string") continue;
    if (!HEADER_NAME.test(c.name)) continue;
    const value = c.data.split(";")[0].trim();
    if (!HEADER_VALUE.test(value)) continue;
    out[c.name] = value;
  }
  return out;
}

function hasRefreshCredential(headers) {
  return Object.keys(headers).some((k) => /refreshtokencredential/i.test(k));
}

// options (for tests): { platform, loader: () => ({ available, native, loadError }),
//   fromPartition: (name) => session, now: () => ms }
function createWindowsSso(options) {
  const o = options || {};
  const platform = o.platform || process.platform;
  const load = o.loader || (() => require("./native/windows-sso"));
  const fromPartition = o.fromPartition || ((name) => require("electron").session.fromPartition(name));
  const now = o.now || Date.now;
  let mod = null;
  let cached = null; // { at, available }
  const enabled = new Map(); // partition -> owner plugin id

  function getNative() {
    if (platform !== "win32") return null;
    if (!mod) {
      try {
        mod = load();
      } catch (e) {
        mod = { available: false, loadError: e };
      }
      if (!mod.available && mod.loadError) console.warn("[WindowsSSO] Not available:", mod.loadError.message || mod.loadError);
    }
    return mod.available ? mod.native : null;
  }

  // The headers to add to a request for `url`, or {} (not a login URL, not
  // Windows, no proof on this PC, or Windows refused).
  async function headersFor(url) {
    if (!isLoginUrl(url)) return {};
    const native = getNative();
    if (!native) return {};
    try {
      return headersFromCookies(await native.getCookies(String(url)));
    } catch (e) {
      console.warn("[WindowsSSO] getCookies failed:", e && e.message);
      return {};
    }
  }

  // True when Windows has a device sign-on proof for Microsoft sign-in here,
  // i.e. the PC is registered with Entra ID and a work account is signed in.
  async function isAvailable() {
    if (cached && now() - cached.at < AVAILABLE_CACHE_MS) return cached.available;
    const available = hasRefreshCredential(await headersFor("https://" + LOGIN_HOSTS[0] + "/"));
    cached = { at: now(), available };
    return available;
  }

  function onBeforeSendHeaders(details, callback) {
    if (!details || !PAGE_LOADS.has(details.resourceType) || !isLoginUrl(details.url)) {
      callback({});
      return;
    }
    headersFor(details.url).then((extra) => {
      if (!Object.keys(extra).length) { callback({}); return; }
      const requestHeaders = Object.assign({}, details.requestHeaders);
      // Never let a page-supplied header of the same name through alongside ours.
      for (const k of Object.keys(requestHeaders)) if (HEADER_NAME.test(k)) delete requestHeaders[k];
      Object.assign(requestHeaders, extra);
      callback({ requestHeaders });
    }, () => callback({}));
  }

  // Turns the headers on or off for a "persist:" session. It takes over that
  // session's onBeforeSendHeaders (Electron allows one listener per session).
  // A session already turned on by another plugin can't be taken.
  function setForPartition(ownerId, partition, on) {
    if (typeof partition !== "string" || !PARTITION_PATTERN.test(partition)) {
      throw new Error("windowsSso: partition must be a \"persist:\" session name");
    }
    const owner = enabled.get(partition);
    if (owner && owner !== ownerId) throw new Error("windowsSso: " + partition + " belongs to another plugin");
    const ses = fromPartition(partition);
    if (on) {
      ses.webRequest.onBeforeSendHeaders({ urls: LOGIN_HOSTS.map((h) => "https://" + h + "/*") }, onBeforeSendHeaders);
      enabled.set(partition, ownerId);
    } else if (owner) {
      ses.webRequest.onBeforeSendHeaders(null);
      enabled.delete(partition);
    }
    return !!on;
  }

  // The object a plugin sees as api.windowsSso, bound to its id.
  function forPlugin(pluginId) {
    return Object.freeze({
      isAvailable: () => isAvailable(),
      setForPartition: (partition, on) => setForPartition(pluginId, partition, on),
    });
  }

  return { isAvailable, headersFor, setForPartition, forPlugin, _onBeforeSendHeaders: onBeforeSendHeaders };
}

let shared = null;
function getShared() {
  if (!shared) shared = createWindowsSso();
  return shared;
}

module.exports = { createWindowsSso, getShared, isLoginUrl, headersFromCookies, LOGIN_HOSTS };
