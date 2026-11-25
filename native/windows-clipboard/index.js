"use strict";

const path = require("path");

// Loads the compiled private clipboard addon (build/Release/windows_clipboard.node).
// Only built on Windows ("npm run build-native"); anywhere else, or when the
// build is missing, `available` is false and the app carries on without it.

let native = null;
let loadError = null;

if (process.platform === "win32") {
  try {
    native = require(path.join(__dirname, "build", "Release", "windows_clipboard.node"));
  } catch (e) {
    loadError = e;
  }
}

module.exports = {
  available: !!native,
  loadError,
  native,
};
