"use strict";

// ConnectWise Manage plugin — main process
//
// Declares the plugin's settings and tells the app about the Custom URL host; the
// site adapter is in renderer.js.

// A host name of one or more labels ("cw.acme.com", "cw.acme.local", "cwserver")
// or an IPv4 address. Mirrors CUSTOM_HOST_PATTERN in renderer.js.
const CUSTOM_HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

// Hosts another site plugin owns: claiming one would take its tabs over.
const OTHER_SITE_HOST_PATTERN = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/;

// True for "" (not set) or a bare lower-case host name that isn't another site's.
function validCustomHost(host) {
  if (typeof host !== "string") return false;
  if (host === "") return true;
  return CUSTOM_HOST_PATTERN.test(host) && !OTHER_SITE_HOST_PATTERN.test(host);
}

// The hosts for api.setSiteHosts: the Custom URL host when one is set and valid.
function customSiteHosts(settings) {
  const host = settings && settings.cwCustomHost;
  return typeof host === "string" && host && validCustomHost(host) ? [host] : [];
}

module.exports = {

  init: function (api) {
    // The app (0.8.3+) then gives the Custom URL host what myconnectwise.net gets:
    // the Chrome user agent and sign-in popups that open as real windows. Older
    // apps don't have the hook; there the host is only recognised by the adapter.
    if (typeof api.setSiteHosts !== "function") return;
    let last = null;
    const apply = function (settings) {
      const hosts = customSiteHosts(settings);
      const key = JSON.stringify(hosts);
      if (key === last) return;
      last = key;
      api.setSiteHosts(hosts);
    };
    apply(api.getSettings());
    api.on("settings:changed", apply);
  },

  defaultSettings: {
    // Host of a self-hosted or custom-domain ConnectWise Manage server, e.g.
    // "cw.acme.com". Pages on it are treated as ConnectWise Manage.
    cwCustomHost: "",
  },

  validateSettings: function (s) {
    if (s.cwCustomHost !== undefined && !validCustomHost(s.cwCustomHost)) return false;
    return true;
  },

  // Exported for tests.
  validCustomHost,
  customSiteHosts,
};
