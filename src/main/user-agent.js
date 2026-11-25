"use strict";

// Which requests in the tabs carry a plain Chrome user agent instead of
// Electron's own ("... msp-plus-plus/0.8.9 Chrome/... Electron/42... Safari/...").
//
// Site plugins ask for it on their hosts ("site.chromeUserAgent"). Microsoft's
// sign-in pages always get it: Entra ID decides from the user agent whether the
// browser can do passkeys (FIDO2), and it doesn't recognise Electron's, so it
// hides the passkey option. When a Conditional Access policy requires a passkey,
// sign-in then stops with "You can't get there from here ... this app doesn't
// support it". Chromium inside MSP++ does support passkeys (through Windows Hello
// on Windows), so telling Entra it is Chrome is accurate about what it can do.

// Exact hosts of Microsoft's sign-in pages (work/school and personal accounts).
const MICROSOFT_LOGIN_HOSTS = [
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.live.com",
  "device.login.microsoftonline.com",
];

// A Chrome user agent for this platform, with the bundled Chromium's version so
// it never looks outdated.
function chromeUserAgent(chromeVersion, platform) {
  let os = "Windows NT 10.0; Win64; x64";
  if (platform === "darwin") os = "Macintosh; Intel Mac OS X 10_15_7";
  else if (platform === "linux") os = "X11; Linux x86_64";
  return "Mozilla/5.0 (" + os + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" +
    chromeVersion + " Safari/537.36";
}

// The hosts to rewrite, from the site plugins: { hosts } match a host and its
// subdomains, { exactHosts } match only themselves. Microsoft sign-in hosts are
// always included.
function userAgentHosts(sites) {
  const hosts = [];
  const exactHosts = [];
  for (const site of sites || []) {
    if (!site || !site.chromeUserAgent) continue;
    for (const h of site.hosts || []) if (!hosts.includes(h)) hosts.push(h);
    for (const h of site.extraHosts || []) if (!exactHosts.includes(h)) exactHosts.push(h);
  }
  for (const h of MICROSOFT_LOGIN_HOSTS) if (!exactHosts.includes(h)) exactHosts.push(h);
  return { hosts, exactHosts };
}

module.exports = { MICROSOFT_LOGIN_HOSTS, chromeUserAgent, userAgentHosts };
