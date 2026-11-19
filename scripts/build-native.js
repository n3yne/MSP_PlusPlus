"use strict";

// Builds the Windows Hello addon (native/windows-hello) on Windows.
//
//   node scripts/build-native.js           for the installed Electron (release builds)
//   node scripts/build-native.js --node    for plain Node (the CI smoke test)
//
// It is a Node-API addon, so one build works in any Electron with the same
// Node-API version; building against Electron's headers is just the safe default.
// Needs Visual Studio Build Tools with the "Desktop development with C++"
// workload (it includes the Windows SDK) and Python, which node-gyp uses.
// Anywhere else it does nothing: the app runs without Windows Hello.

const path = require("path");
const { spawnSync } = require("child_process");

if (process.platform !== "win32") {
  console.log("[build-native] Not Windows: skipping the Windows Hello addon.");
  process.exit(0);
}

const root = path.join(__dirname, "..");
const forNode = process.argv.includes("--node");
const args = ["rebuild", "--directory", path.join(root, "native", "windows-hello")];
if (!forNode) {
  const electronVersion = require(path.join(root, "node_modules", "electron", "package.json")).version;
  args.push("--target=" + electronVersion, "--dist-url=https://electronjs.org/headers");
  console.log("[build-native] Building the Windows Hello addon for Electron " + electronVersion);
} else {
  console.log("[build-native] Building the Windows Hello addon for Node " + process.version);
}

const gyp = require.resolve("node-gyp/bin/node-gyp.js", { paths: [root] });
const res = spawnSync(process.execPath, [gyp].concat(args), { stdio: "inherit", cwd: root });
process.exit(res.status === null ? 1 : res.status);
