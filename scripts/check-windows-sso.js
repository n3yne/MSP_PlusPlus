"use strict";

// CI smoke test for the Windows device sign-on addon: it loads, and Windows
// answers getCookies() for the Microsoft login URL (an empty list on a build
// server, which isn't registered with Entra ID). Run after
// "node scripts/build-native.js --node". Fails if the addon didn't load or the
// call threw.

const sso = require("../native/windows-sso");

if (process.platform !== "win32") {
  console.log("[check-windows-sso] Not Windows: nothing to check.");
  process.exit(0);
}
if (!sso.available) {
  console.error("[check-windows-sso] The addon didn't load:", sso.loadError && sso.loadError.message);
  process.exit(1);
}
if (typeof sso.native.getCookies !== "function") {
  console.error("[check-windows-sso] Missing export: getCookies");
  process.exit(1);
}

// Argument checks run before Windows is asked.
try {
  sso.native.getCookies("http://login.microsoftonline.com/");
  console.error("[check-windows-sso] An http:// URL was accepted");
  process.exit(1);
} catch (e) {
  console.log("[check-windows-sso] http:// refused:", e.message);
}

const timer = setTimeout(() => {
  console.error("[check-windows-sso] getCookies() didn't answer in 30 seconds");
  process.exit(1);
}, 30000);

sso.native.getCookies("https://login.microsoftonline.com/").then((cookies) => {
  clearTimeout(timer);
  if (!Array.isArray(cookies)) {
    console.error("[check-windows-sso] getCookies() didn't return a list");
    process.exit(1);
  }
  // Names only: the values are credentials.
  console.log("[check-windows-sso] Loaded. Entries here:", cookies.length, cookies.map((c) => c.name).join(", "));
  process.exit(0);
}, (e) => {
  clearTimeout(timer);
  console.error("[check-windows-sso] getCookies() failed:", e.message);
  process.exit(1);
});
