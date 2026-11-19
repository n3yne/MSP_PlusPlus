"use strict";

// CI smoke test for the Windows Hello addon: it loads, and Windows answers
// isSupported() (false on a build server, which has no Windows Hello). Run
// after "node scripts/build-native.js --node". Fails if the addon didn't load.

const hello = require("../native/windows-hello");

if (process.platform !== "win32") {
  console.log("[check-windows-hello] Not Windows: nothing to check.");
  process.exit(0);
}
if (!hello.available) {
  console.error("[check-windows-hello] The addon didn't load:", hello.loadError && hello.loadError.message);
  process.exit(1);
}

const timer = setTimeout(() => {
  console.error("[check-windows-hello] isSupported() didn't answer in 30 seconds");
  process.exit(1);
}, 30000);

hello.native.isSupported().then((supported) => {
  clearTimeout(timer);
  console.log("[check-windows-hello] Loaded. Windows Hello supported here:", supported);
  for (const name of ["isSupported", "sign", "remove"]) {
    if (typeof hello.native[name] !== "function") {
      console.error("[check-windows-hello] Missing export:", name);
      process.exit(1);
    }
  }
  // Argument checks run before Windows is asked.
  try {
    hello.native.sign("MSP++ ci-check", Buffer.alloc(4), false);
    console.error("[check-windows-hello] A 4-byte challenge was accepted");
    process.exit(1);
  } catch (e) {
    console.log("[check-windows-hello] Short challenge refused:", e.message);
  }
  process.exit(0);
}, (e) => {
  clearTimeout(timer);
  console.error("[check-windows-hello] isSupported() failed:", e.message);
  process.exit(1);
});
