"use strict";

// ConnectWise Manage plugin — main process
//
// Only declares the plugin's settings; the site adapter is in renderer.js.

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

module.exports = {

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
};
