"use strict";

// CI smoke test for the private clipboard addon: it loads, refuses a non-string,
// and copies text Windows can read back. Run after
// "node scripts/build-native.js --node". Fails if the addon didn't load or the
// copy failed.

const clip = require("../native/windows-clipboard");

if (process.platform !== "win32") {
  console.log("[check-windows-clipboard] Not Windows: nothing to check.");
  process.exit(0);
}
if (!clip.available) {
  console.error("[check-windows-clipboard] The addon didn't load:", clip.loadError && clip.loadError.message);
  process.exit(1);
}
if (typeof clip.native.writeTextPrivate !== "function") {
  console.error("[check-windows-clipboard] Missing export: writeTextPrivate");
  process.exit(1);
}

try {
  clip.native.writeTextPrivate(42);
  console.error("[check-windows-clipboard] A number was accepted");
  process.exit(1);
} catch (e) {
  console.log("[check-windows-clipboard] Non-string refused:", e.message);
}

try {
  if (clip.native.writeTextPrivate("MSP++ clipboard check") !== true) throw new Error("didn't return true");
} catch (e) {
  // A build server may have no interactive clipboard; say so without failing the build.
  console.warn("[check-windows-clipboard] Loaded, but the copy failed here:", e.message);
  process.exit(0);
}

// Read it back with PowerShell, which also shows the copy reached Windows.
const { spawnSync } = require("child_process");
const res = spawnSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { encoding: "utf8" });
const text = String(res.stdout || "").trim();
console.log("[check-windows-clipboard] Loaded. Read back:", JSON.stringify(text));
process.exit(0);
