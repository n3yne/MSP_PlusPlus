"use strict";

// Builds the native addons on Windows:
//   native/windows-hello  Windows Hello (api.windowsHello)
//   native/windows-sso    Windows device sign-on for Microsoft sign-in (api.windowsSso)
//   native/windows-clipboard  private clipboard copies (api.clipboard)
//
//   node scripts/build-native.js           for the installed Electron (release builds)
//   node scripts/build-native.js --node    for plain Node (the CI smoke test)
//
// They are Node-API addons, so one build works in any Electron with the same
// Node-API version; building against Electron's headers is just the safe default.
// Needs Visual Studio Build Tools with the "Desktop development with C++"
// workload (it includes the Windows SDK) and Python, which node-gyp uses.
// Anywhere else it does nothing: the app runs without them.

const path = require("path");
const { spawnSync } = require("child_process");

const ADDONS = ["windows-hello", "windows-sso", "windows-clipboard"];

if (process.platform !== "win32") {
  console.log("[build-native] Not Windows: skipping the native addons.");
  process.exit(0);
}

const root = path.join(__dirname, "..");
const forNode = process.argv.includes("--node");
const gyp = require.resolve("node-gyp/bin/node-gyp.js", { paths: [root] });
let electronVersion = "";
if (!forNode) electronVersion = require(path.join(root, "node_modules", "electron", "package.json")).version;

for (const addon of ADDONS) {
  const args = ["rebuild", "--directory", path.join(root, "native", addon)];
  if (!forNode) {
    args.push("--target=" + electronVersion, "--dist-url=https://electronjs.org/headers");
    console.log("[build-native] Building " + addon + " for Electron " + electronVersion);
  } else {
    console.log("[build-native] Building " + addon + " for Node " + process.version);
  }
  const res = spawnSync(process.execPath, [gyp].concat(args), { stdio: "inherit", cwd: root });
  if (res.status !== 0) process.exit(res.status === null ? 1 : res.status);
}
