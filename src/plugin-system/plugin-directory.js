"use strict";

// The plugin directory: plugins you can install from inside MSP++ instead of
// every copy of the app bundling them (Settings > Plugins > Browse).
//
// Where things live, under the app's data folder:
//   installed-plugins/<id>/            code of a plugin installed from the directory
//                                      or imported from a file or folder
//   installed-plugins/registry.json    { "<id>": { source, version, sha256, installedAt } }
//   installed-plugins/.pending/<id>/   a downloaded install or update, waiting for restart
//   installed-plugins/pending.json     { install: { "<id>": {...} }, remove: { "<id>": {...} } }
//   plugins/<id>/                      each plugin's own data (getDataPath()), never
//                                      touched by an install, update or remove
//
// Main-process plugin code can't be unloaded, so every change is staged and
// applied by applyPending() at the next start, before any plugin loads. That also
// means nothing is ever replaced while Windows has its files open.
//
// The directory itself is index.json on the "plugin-directory" GitHub release
// (a pre-release, so the app updater, which follows releases/latest, never sees
// it). Each entry carries the package's SHA-256 and size; a download that
// doesn't match exactly is refused before anything is unpacked.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PluginPackage = require("./plugin-package");
const PluginStages = require("../shared/plugin-stages");

const DEFAULT_INDEX_URL = "https://github.com/n3yne/MSP_PlusPlus/releases/download/plugin-directory/index.json";
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
// major.minor.patch, plus an optional fourth part for a plugin-only fix made
// between app releases (0.8.7.1 belongs to app 0.8.7). Apps before 0.8.7 only
// accept three parts and skip four-part index entries.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_INDEX_ENTRIES = 500;
const MAX_REQUIRES = 10;

const INSTALLED_DIR = "installed-plugins";
const PENDING_DIR = ".pending";

// ===================== Versions =====================

function parseVersion(str) {
  const m = String(str || "").match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/);
  return m ? [+m[1], +m[2], +m[3], +(m[4] || 0)] : [0, 0, 0, 0];
}

// -1, 0 or 1. major.minor.patch and the optional fourth part count (a missing
// fourth part is 0, so 0.8.7 < 0.8.7.1 < 0.8.8); any -/+ suffix is ignored.
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

// ===================== Index =====================

function cleanText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Validates a parsed index.json. Returns { plugins: [entry] }; entries that are
// malformed are dropped (and logged), so one bad entry can't hide the rest.
// Package URLs are resolved against the index URL and must stay inside the same
// release folder.
function parseIndex(json, indexUrl, logger = console) {
  if (!json || typeof json !== "object" || !Array.isArray(json.plugins)) {
    throw new Error("The plugin directory's index isn't in the expected format");
  }
  const base = indexUrl.slice(0, indexUrl.lastIndexOf("/") + 1);
  const plugins = [];
  const seen = new Set();
  for (const raw of json.plugins.slice(0, MAX_INDEX_ENTRIES)) {
    const e = raw && typeof raw === "object" ? raw : {};
    const problem = (msg) => logger.warn(`[PluginDirectory] Skipped index entry "${e.id}": ${msg}`);
    if (typeof e.id !== "string" || !ID_PATTERN.test(e.id)) { problem("invalid id"); continue; }
    if (seen.has(e.id)) { problem("listed twice"); continue; }
    if (typeof e.version !== "string" || !VERSION_PATTERN.test(e.version)) { problem("invalid version"); continue; }
    if (e.minAppVersion !== undefined && (typeof e.minAppVersion !== "string" || !VERSION_PATTERN.test(e.minAppVersion))) {
      problem("invalid minAppVersion"); continue;
    }
    if (typeof e.sha256 !== "string" || !SHA256_PATTERN.test(e.sha256.toLowerCase())) { problem("invalid sha256"); continue; }
    if (!Number.isInteger(e.size) || e.size <= 0 || e.size > PluginPackage.MAX_PACKAGE_BYTES) { problem("invalid size"); continue; }
    let url;
    try {
      url = new URL(String(e.url || ""), base).href;
    } catch { problem("invalid url"); continue; }
    if (!url.startsWith(base) || url.includes("?") || url.includes("#")) { problem("url outside the directory"); continue; }
    const requires = Array.isArray(e.requires)
      ? e.requires.filter(r => typeof r === "string" && ID_PATTERN.test(r) && r !== e.id).slice(0, MAX_REQUIRES)
      : [];
    seen.add(e.id);
    plugins.push({
      id: e.id,
      name: cleanText(e.name, 80) || e.id,
      description: cleanText(e.description, 500),
      category: cleanText(e.category, 40),
      version: e.version,
      minAppVersion: e.minAppVersion || "",
      requires,
      url,
      sha256: e.sha256.toLowerCase(),
      size: e.size,
      changelog: cleanText(e.changelog, 2000),
      site: e.site === true,
      // Release stage (plugin-stages.js); missing or unknown is stable.
      stage: PluginStages.normalizeStage(e.stage),
    });
  }
  return { plugins };
}

// ===================== Files on disk =====================

function installedRoot(userData) {
  return path.join(userData, INSTALLED_DIR);
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tmp, file);
}

function readRegistry(userData) {
  return readJson(path.join(installedRoot(userData), "registry.json"), {});
}

function writeRegistry(userData, registry) {
  writeJson(path.join(installedRoot(userData), "registry.json"), registry);
}

function readPending(userData) {
  const p = readJson(path.join(installedRoot(userData), "pending.json"), {});
  return {
    install: p.install && typeof p.install === "object" ? p.install : {},
    remove: p.remove && typeof p.remove === "object" ? p.remove : {},
  };
}

function writePending(userData, pending) {
  writeJson(path.join(installedRoot(userData), "pending.json"), pending);
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
}

// Error codes Windows gives while something else (antivirus scanning freshly
// written files, the search indexer, Explorer) briefly has a file open.
const TRANSIENT_FS_CODES = new Set(["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"]);
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1500];

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Renames a folder, waiting out short-lived locks. If it still can't be renamed
// after the retries, copies it instead and deletes the source (a leftover source
// is swept up by cleanupStaleTemp at the next start). Options are for tests.
function moveDirSync(from, to, { delays = RENAME_RETRY_DELAYS_MS, sleep = sleepSync, fsImpl = fs } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      fsImpl.renameSync(from, to);
      return;
    } catch (err) {
      if (!TRANSIENT_FS_CODES.has(err && err.code)) throw err;
      lastErr = err;
      if (attempt < delays.length) sleep(delays[attempt]);
    }
  }
  try {
    fsImpl.rmSync(to, { recursive: true, force: true, maxRetries: 3 });
    fsImpl.cpSync(from, to, { recursive: true, errorOnExist: false, force: true });
  } catch {
    try { fsImpl.rmSync(to, { recursive: true, force: true, maxRetries: 3 }); } catch { /* best effort */ }
    throw lastErr;
  }
  try { fsImpl.rmSync(from, { recursive: true, force: true, maxRetries: 3 }); } catch { /* swept up later */ }
}

// Deletes "<id>.tmp-xxxxxxxx" folders in .pending left by a download that was
// interrupted or failed partway. Never throws.
function cleanupStaleTemp(userData, logger = console) {
  const pendingRoot = path.join(installedRoot(userData), PENDING_DIR);
  let names;
  try { names = fs.readdirSync(pendingRoot); } catch { return; }
  for (const name of names) {
    if (!/\.tmp-[0-9a-f]{8}$/.test(name)) continue;
    try { rmrf(path.join(pendingRoot, name)); } catch (err) {
      logger.warn(`[PluginDirectory] Couldn't delete leftover "${name}":`, err.message || err);
    }
  }
}

// Plugins imported before 0.8 were unpacked into their own data folder
// (plugins/<id>, which the plugin also writes its data to). From 0.8.3 code never
// loads from a data folder, so a page or a plugin bug that writes a file there
// can't turn into code that runs. Each such plugin is copied into
// installed-plugins/<id> (unless a copy at least as new is there already) and its
// manifest.json in the data folder is renamed, so it is no longer a plugin; its
// data stays where it is. Never throws.
const LEGACY_MANIFEST_SUFFIX = ".moved-to-installed-plugins";
function migrateLegacyImports(userData, logger = console) {
  const dataRoot = path.join(userData, "plugins");
  let names;
  try { names = fs.readdirSync(dataRoot, { withFileTypes: true }); } catch { return []; }
  const root = installedRoot(userData);
  const moved = [];
  for (const entry of names) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(dataRoot, entry.name);
    const manifestFile = path.join(dir, "manifest.json");
    const manifest = readJson(manifestFile, null);
    if (!manifest) continue;
    try {
      const id = manifest.id;
      if (typeof id === "string" && ID_PATTERN.test(id)) {
        const dest = path.join(root, id);
        const installed = readJson(path.join(dest, "manifest.json"), null);
        const version = typeof manifest.version === "string" ? manifest.version : "";
        if (!installed || compareVersions(version, installed.version) > 0) {
          const tmp = path.join(root, `${id}.tmp-${crypto.randomBytes(4).toString("hex")}`);
          fs.mkdirSync(root, { recursive: true });
          fs.cpSync(dir, tmp, { recursive: true, errorOnExist: false, force: true });
          rmrf(dest);
          moveDirSync(tmp, dest);
          const registry = readRegistry(userData);
          registry[id] = { source: "imported", version, installedAt: new Date().toISOString() };
          writeRegistry(userData, registry);
        }
        // Before 0.8.3, removing such a plugin also removed its data folder (the
        // Remove prompt said so); keep that promise for a removal already staged.
        const pending = readPending(userData);
        if (pending.remove[id]) {
          pending.remove[id] = Object.assign({}, pending.remove[id], { deleteData: true });
          writePending(userData, pending);
        }
        moved.push(id);
      }
      fs.renameSync(manifestFile, manifestFile + LEGACY_MANIFEST_SUFFIX);
    } catch (err) {
      logger.error(`[PluginDirectory] Couldn't move the plugin in "${dir}" out of its data folder:`, err);
    }
  }
  return moved;
}

// Applies staged installs, updates and removals. Run once at startup, before
// plugins load. Never throws: a change that fails stays pending, is logged, and
// is retried at the next start.
function applyPending(userData, logger = console) {
  cleanupStaleTemp(userData, logger);
  migrateLegacyImports(userData, logger);
  const root = installedRoot(userData);
  const pending = readPending(userData);
  const ids = Object.keys(pending.install).concat(Object.keys(pending.remove));
  if (ids.length === 0) return { applied: [], failed: [] };

  const registry = readRegistry(userData);
  const applied = [];
  const failed = [];

  for (const id of Object.keys(pending.remove)) {
    if (!ID_PATTERN.test(id)) { delete pending.remove[id]; continue; }
    try {
      const opts = pending.remove[id] || {};
      rmrf(path.join(root, id));
      const dataDir = path.join(userData, "plugins", id);
      // A plugin imported before 0.8 lives in its own data folder (plugins/<id>
      // with a manifest.json), so removing it removes that folder.
      const legacy = fs.existsSync(path.join(dataDir, "manifest.json"));
      if (legacy || opts.deleteData) rmrf(dataDir);
      delete registry[id];
      delete pending.remove[id];
      applied.push({ id, action: "remove" });
    } catch (err) {
      logger.error(`[PluginDirectory] Couldn't remove "${id}":`, err);
      failed.push({ id, action: "remove", error: err.message || String(err) });
    }
  }

  for (const id of Object.keys(pending.install)) {
    const staged = path.join(root, PENDING_DIR, id);
    if (!ID_PATTERN.test(id) || !fs.existsSync(path.join(staged, "manifest.json"))) {
      delete pending.install[id];
      continue;
    }
    try {
      const dest = path.join(root, id);
      rmrf(dest);
      moveDirSync(staged, dest);
      const info = pending.install[id] || {};
      registry[id] = {
        source: info.source === "imported" ? "imported" : "directory",
        version: typeof info.version === "string" ? info.version : "",
        sha256: typeof info.sha256 === "string" && SHA256_PATTERN.test(info.sha256) ? info.sha256 : "",
        installedAt: new Date().toISOString(),
      };
      delete pending.install[id];
      applied.push({ id, action: "install" });
    } catch (err) {
      logger.error(`[PluginDirectory] Couldn't install "${id}":`, err);
      failed.push({ id, action: "install", error: err.message || String(err) });
    }
  }

  try {
    writeRegistry(userData, registry);
    writePending(userData, pending);
    if (Object.keys(pending.install).length === 0) rmrf(path.join(root, PENDING_DIR));
  } catch (err) {
    logger.error("[PluginDirectory] Couldn't save plugin changes:", err);
  }
  return { applied, failed };
}

// Puts a package's files in .pending/<id> and records the change. Replaces any
// earlier staged copy of the same plugin, and cancels a staged removal of it.
// sha256 is the package's, kept in the registry so an install can be traced back.
function stagePackage(userData, files, manifest, source, sha256 = "") {
  const id = manifest.id;
  const root = installedRoot(userData);
  const pendingRoot = path.join(root, PENDING_DIR);
  const tmp = path.join(pendingRoot, `${id}.tmp-${crypto.randomBytes(4).toString("hex")}`);
  const dest = path.join(pendingRoot, id);
  try {
    PluginPackage.writeFiles(files, tmp);
    rmrf(dest);
    moveDirSync(tmp, dest);
  } catch (err) {
    rmrf(tmp);
    throw err;
  }
  const pending = readPending(userData);
  pending.install[id] = { version: typeof manifest.version === "string" ? manifest.version : "", source, sha256 };
  delete pending.remove[id];
  writePending(userData, pending);
}

function stageRemove(userData, id, { deleteData = false } = {}) {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid plugin id");
  const pending = readPending(userData);
  if (pending.install[id]) {
    // Removing something not yet installed just cancels the install.
    delete pending.install[id];
    rmrf(path.join(installedRoot(userData), PENDING_DIR, id));
    const installedNow = fs.existsSync(path.join(installedRoot(userData), id, "manifest.json")) ||
      fs.existsSync(path.join(userData, "plugins", id, "manifest.json"));
    if (!installedNow) {
      writePending(userData, pending);
      return { cancelled: true };
    }
  }
  pending.remove[id] = { deleteData: deleteData === true };
  writePending(userData, pending);
  return { cancelled: false };
}

// Undoes a staged change: a staged install/update is dropped, a staged removal kept off.
function cancelPending(userData, id) {
  if (!ID_PATTERN.test(id)) return;
  const pending = readPending(userData);
  delete pending.install[id];
  delete pending.remove[id];
  rmrf(path.join(installedRoot(userData), PENDING_DIR, id));
  writePending(userData, pending);
}

// ===================== Plugins that moved out of the app =====================

// Plugins bundled up to 0.7 moved to the directory in 0.8, and the rest after
// 0.8.0 (moved-plugins.json). The first start without them offers to reinstall
// them. A plugin is pre-ticked when there are signs it was in use: a setting
// changed from its default, a saved API key, a data file, one of its site's
// hosts in the open tabs or the settings, (alsoIf) another moved plugin that
// was in use, or (onByDefault) it was on for everyone and wasn't turned off.
// A new install has nothing to reinstall, so it gets nothing back.
//
//   moved          moved-plugins.json "plugins"
//   settings       the raw settings.json object
//   pluginsConfig  plugins-config.json ({ id: false } for plugins turned off)
//   installedIds   ids loaded now (bundled or installed)
//   handled        ids already offered (moved-handled.json)
//   tabsText       open-tabs.json as text, for hosts
//   existingInstall  false on the very first start (no settings.json yet)
// Returns [{ id, name, used }] for the plugins still to offer.
function findMovedPlugins({ userData, moved, settings = {}, pluginsConfig = {}, installedIds = [], handled = [], tabsText = "", existingInstall = true }) {
  if (!existingInstall) return [];
  const list = Array.isArray(moved) ? moved : [];
  const settingsText = JSON.stringify(settings || {});
  const usedById = new Map();
  function changedSetting(entry) {
    return Object.entries(entry.settings || {}).some(([key, def]) =>
      Object.prototype.hasOwnProperty.call(settings, key) && JSON.stringify(settings[key]) !== JSON.stringify(def));
  }
  function savedCredential(entry) {
    return (entry.credentials || []).some(name => typeof settings[name + "Encrypted"] === "string" && settings[name + "Encrypted"]);
  }
  function hasDataFile(entry) {
    return (entry.dataFiles || []).some((file) => {
      try {
        return fs.statSync(path.join(userData, "plugins", entry.id, file)).size > 2;
      } catch { return false; }
    });
  }
  function visitedHost(entry) {
    return (entry.hosts || []).some(h => tabsText.includes(h) || settingsText.includes(h));
  }
  for (const entry of list) {
    if (!entry || !ID_PATTERN.test(entry.id)) continue;
    usedById.set(entry.id, pluginsConfig[entry.id] !== false &&
      (entry.onByDefault === true || changedSetting(entry) || savedCredential(entry) || hasDataFile(entry) || visitedHost(entry)));
  }
  for (const entry of list) {
    if (entry && entry.alsoIf && usedById.get(entry.alsoIf) && pluginsConfig[entry.id] !== false) usedById.set(entry.id, true);
  }
  return list
    .filter(e => e && usedById.has(e.id) && !installedIds.includes(e.id) && !handled.includes(e.id))
    .map(e => ({ id: e.id, name: typeof e.name === "string" ? e.name : e.id, used: usedById.get(e.id) }));
}

function readMovedHandled(userData) {
  const list = readJson(path.join(installedRoot(userData), "moved-handled.json"), {}).ids;
  return Array.isArray(list) ? list.filter(id => typeof id === "string") : [];
}

function writeMovedHandled(userData, ids) {
  writeJson(path.join(installedRoot(userData), "moved-handled.json"), { ids: Array.from(new Set(ids)) });
}

// ===================== First-start plugin picker =====================

// With no site plugin installed (a new install, or an update from a version
// that bundled Freshservice), the main window asks which plugins to install.
// "Don't ask again" is kept in installed-plugins/setup.json.

function readSetupState(userData) {
  const s = readJson(path.join(installedRoot(userData), "setup.json"), {});
  return { dontAsk: s.dontAsk === true };
}

function writeSetupState(userData, state) {
  writeJson(path.join(installedRoot(userData), "setup.json"), { dontAsk: state && state.dontAsk === true });
}

// True when the picker should open: no site plugin is installed (on or off)
// and the user hasn't said not to ask.
//   installed  pluginManager.getPluginInfo()
function needsPluginSetup({ installed = [], dontAsk = false }) {
  if (dontAsk) return false;
  return !installed.some(p => p && (p.site || p.category === "Sites"));
}

// ===================== The service =====================

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Reads a fetch response's body, giving up (with tooLarge) as soon as it passes
// max bytes, so a server that sends no length, or lies about it, can't make the
// app hold an unbounded download in memory.
async function readLimited(resp, max, tooLarge) {
  const len = Number(resp.headers && typeof resp.headers.get === "function" && resp.headers.get("content-length"));
  if (len && len > max) throw new Error(tooLarge);
  const body = resp.body;
  if (!body || typeof body.getReader !== "function") {
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > max) throw new Error(tooLarge);
    return buf;
  }
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      throw new Error(tooLarge);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

// opts:
//   userData      the app's data folder
//   appVersion    running app version, for minAppVersion
//   getInstalled  () => [{ id, version, source, loaded, ... }] (pluginManager.getPluginInfo)
//   indexUrl      directory index (defaults to the plugin-directory release)
//   fetchImpl     fetch-compatible function
//   getUpdateStage (id) => lowest release stage the user takes updates of that
//                 plugin at (plugin-stages.js updateStageFor); default "beta"
function createPluginDirectory(opts) {
  const {
    userData,
    appVersion,
    getInstalled = () => [],
    indexUrl = DEFAULT_INDEX_URL,
    fetchImpl = (...args) => fetch(...args),
    logger = console,
    indexTimeoutMs = 20000,
    getUpdateStage = () => PluginStages.DEFAULT_UPDATE_STAGE,
  } = opts;
  const userAgent = "MSP-PP/" + appVersion;

  let index = { plugins: [] };
  let fetchedAt = 0;
  let lastError = "";
  let etag = "";
  let inFlight = null;
  let moved = [];

  async function fetchIndex() {
    const headers = { "User-Agent": userAgent, Accept: "application/json" };
    if (etag && index.plugins.length) headers["If-None-Match"] = etag;
    // Offline or behind a proxy that never answers, a fetch can hang for
    // minutes; the first-start picker waits on this, so give up sooner.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("The plugin directory didn't answer. Check the internet connection and try again.")), indexTimeoutMs);
    });
    let resp;
    try {
      resp = await Promise.race([fetchImpl(indexUrl, { headers }), timeout]);
    } finally {
      clearTimeout(timer);
    }
    if (resp.status === 304) return;
    if (resp.status === 404) throw new Error("The plugin directory hasn't been published yet");
    if (!resp.ok) throw new Error(`The plugin directory answered with error ${resp.status}`);
    const text = (await readLimited(resp, MAX_INDEX_BYTES, "The plugin directory's index is too large")).toString("utf8");
    let json;
    try { json = JSON.parse(text); } catch { throw new Error("The plugin directory's index isn't valid JSON"); }
    index = parseIndex(json, indexUrl, logger);
    etag = (resp.headers && typeof resp.headers.get === "function" && resp.headers.get("etag")) || "";
  }

  // Fetches the index (at most one request at a time). Never throws; the error
  // is kept in the state for Settings to show.
  function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await fetchIndex();
        fetchedAt = Date.now();
        lastError = "";
      } catch (err) {
        lastError = err.message || String(err);
        logger.warn("[PluginDirectory] Index fetch failed:", lastError);
      } finally {
        inFlight = null;
      }
      return getState();
    })();
    return inFlight;
  }

  function installedMap() {
    const map = new Map();
    for (const p of getInstalled() || []) {
      // getPluginInfo lists only the copy that loaded for each id.
      if (p && p.id && !map.has(p.id)) map.set(p.id, p);
    }
    return map;
  }

  // The directory merged with what's installed and what's waiting for restart.
  function getState() {
    const installed = installedMap();
    const pending = readPending(userData);
    const plugins = index.plugins.map((e) => {
      const have = installed.get(e.id) || null;
      const compatible = !e.minAppVersion || compareVersions(appVersion, e.minAppVersion) >= 0;
      let status = "available";
      if (have) status = compareVersions(e.version, have.version) > 0 ? "update" : "installed";
      if (!compatible && status !== "installed") status = "incompatible";
      // An update below the stage the user takes updates at is still listed
      // (and can be installed by hand from Browse), but isn't counted in
      // `updates`, so it isn't announced or installed automatically.
      let updateStage = PluginStages.DEFAULT_UPDATE_STAGE;
      try { updateStage = PluginStages.normalizeStage(getUpdateStage(e.id)); } catch { /* default */ }
      const belowUpdateStage = status === "update" && !PluginStages.meetsStage(e.stage, updateStage);
      let pendingAction = "";
      if (pending.remove[e.id]) pendingAction = "remove";
      else if (pending.install[e.id]) pendingAction = have ? "update" : "install";
      return Object.assign({}, e, {
        status,
        compatible,
        installedVersion: have ? have.version || "" : "",
        installedSource: have ? have.source || "" : "",
        installedStage: have ? PluginStages.normalizeStage(have.stage) : "",
        updateStage,
        belowUpdateStage,
        pendingAction,
        pendingVersion: pending.install[e.id] ? pending.install[e.id].version || "" : "",
      });
    });
    const updates = plugins.filter(p => p.status === "update" && !p.pendingAction && !p.belowUpdateStage);
    return {
      indexUrl,
      fetchedAt,
      error: lastError,
      plugins,
      updates: updates.map(p => ({ id: p.id, name: p.name, version: p.version, installedVersion: p.installedVersion, stage: p.stage })),
      // Updates waiting for a version at the user's update stage.
      heldBack: plugins.filter(p => p.belowUpdateStage && !p.pendingAction)
        .map(p => ({ id: p.id, name: p.name, version: p.version, stage: p.stage, installedVersion: p.installedVersion, updateStage: p.updateStage })),
      pending: {
        install: Object.keys(pending.install),
        remove: Object.keys(pending.remove),
      },
      // Moved plugins still to offer, minus any already staged for install.
      moved: moved.filter(m => !pending.install[m.id] && !installed.has(m.id)).map(m => Object.assign({}, m, {
        available: index.plugins.some(p => p.id === m.id),
      })),
    };
  }

  function setMoved(list) {
    moved = Array.isArray(list) ? list.slice() : [];
  }

  // The moved-plugins offer was answered (reinstalled or declined): don't ask again.
  function dismissMoved(ids) {
    const done = Array.isArray(ids) ? ids.filter(id => typeof id === "string" && ID_PATTERN.test(id)) : moved.map(m => m.id);
    writeMovedHandled(userData, readMovedHandled(userData).concat(done));
    moved = moved.filter(m => !done.includes(m.id));
  }

  // The ids to install for `ids`, with everything they require, in an order where
  // requirements come first. Already-installed requirements are left out.
  function resolveInstallSet(ids) {
    const byId = new Map(index.plugins.map(p => [p.id, p]));
    const installed = installedMap();
    const pending = readPending(userData);
    const order = [];
    const visiting = new Set();
    const missing = [];
    function visit(id, isRequirement) {
      if (order.includes(id) || visiting.has(id)) return;
      if (isRequirement && (installed.has(id) || pending.install[id]) && !pending.remove[id]) return;
      const entry = byId.get(id);
      if (!entry) { missing.push(id); return; }
      visiting.add(id);
      for (const r of entry.requires) visit(r, true);
      visiting.delete(id);
      order.push(id);
    }
    for (const id of ids) visit(id, false);
    return { order: order.map(id => byId.get(id)), missing };
  }

  async function download(entry) {
    const resp = await fetchImpl(entry.url, { headers: { "User-Agent": userAgent } });
    if (!resp.ok) throw new Error(`Download of ${entry.name} failed (error ${resp.status})`);
    const mismatch = `${entry.name} didn't match the directory's checksum, so it wasn't installed`;
    // entry.size is at most MAX_PACKAGE_BYTES (parseIndex); a longer download can't match.
    const buf = await readLimited(resp, entry.size, mismatch);
    if (buf.length !== entry.size || sha256(buf) !== entry.sha256) throw new Error(mismatch);
    return buf;
  }

  // Downloads, checks and stages one directory entry.
  async function stageEntry(entry) {
    if (entry.minAppVersion && compareVersions(appVersion, entry.minAppVersion) < 0) {
      throw new Error(`${entry.name} needs MSP++ ${entry.minAppVersion} or newer`);
    }
    const buf = await download(entry);
    const { manifest, files } = PluginPackage.readPackage(buf);
    if (manifest.id !== entry.id) throw new Error(`${entry.name}'s package is for a different plugin ("${manifest.id}")`);
    if (manifest.version !== entry.version) {
      throw new Error(`${entry.name}'s package is version ${manifest.version}, not ${entry.version}`);
    }
    stagePackage(userData, files, manifest, "directory", entry.sha256);
    return { id: entry.id, name: entry.name, version: entry.version };
  }

  // Installs (or updates) the given plugins and anything they require. Changes
  // take effect at the next start. Returns { success, staged, error }.
  async function install(ids) {
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === "string" && ID_PATTERN.test(id))) {
      return { success: false, staged: [], error: "Invalid plugin id" };
    }
    if (!index.plugins.length) await refresh();
    const { order, missing } = resolveInstallSet(ids);
    if (missing.length) {
      return { success: false, staged: [], error: `Not in the plugin directory: ${missing.join(", ")}` };
    }
    // One failure doesn't stop the rest: each plugin is staged on its own, and
    // the ones that failed are named so they can be tried again.
    const staged = [];
    const errors = [];
    for (const entry of order) {
      const needs = entry.requires.filter(r => errors.some(e => e.id === r));
      if (needs.length) {
        errors.push({ id: entry.id, message: `${entry.name} wasn't installed because a plugin it needs failed` });
        continue;
      }
      try {
        staged.push(await stageEntry(entry));
      } catch (err) {
        errors.push({ id: entry.id, message: err.message || String(err) });
      }
    }
    if (errors.length) {
      return { success: false, staged, error: errors.map(e => e.message).join("; ") };
    }
    return { success: true, staged, error: "" };
  }

  async function updateAll() {
    const ids = getState().updates.filter(u => {
      const e = index.plugins.find(p => p.id === u.id);
      return e && (!e.minAppVersion || compareVersions(appVersion, e.minAppVersion) >= 0);
    }).map(u => u.id);
    if (ids.length === 0) return { success: true, staged: [], error: "" };
    return install(ids);
  }

  // Imports a .mspplugin file (buffer) or a plugin folder (path) chosen by the
  // user. confirm(info) is asked first, with what the package is and what it would
  // replace, and nothing is staged unless it resolves true:
  //   info = { id, name, version, replaces: { name, version, source } | null }
  // Returns { id, name, version }, or { cancelled: true }.
  async function importPackage({ buffer, folder, confirm }) {
    let buf;
    if (buffer) buf = buffer;
    else if (folder) buf = PluginPackage.packFolder(folder);
    else throw new Error("Nothing to import");
    const { manifest, files } = PluginPackage.readPackage(buf);
    if (manifest.minAppVersion && compareVersions(appVersion, manifest.minAppVersion) < 0) {
      throw new Error(`This plugin needs MSP++ ${manifest.minAppVersion} or newer`);
    }
    const name = cleanText(manifest.name, 80) || manifest.id;
    const version = typeof manifest.version === "string" ? manifest.version.slice(0, 40) : "";
    const have = installedMap().get(manifest.id);
    const info = {
      id: manifest.id,
      name,
      version,
      replaces: have ? { name: have.name || have.id, version: have.version || "", source: have.source || "" } : null,
    };
    if (typeof confirm !== "function" || (await confirm(info)) !== true) return { cancelled: true };
    stagePackage(userData, files, manifest, "imported", sha256(buf));
    return { id: info.id, name, version };
  }

  // Removes an installed (not bundled) plugin at the next start.
  function remove(id, { deleteData = false } = {}) {
    const have = installedMap().get(id);
    const pending = readPending(userData);
    if (!have && !pending.install[id]) return { success: false, error: "That plugin isn't installed" };
    if (have && have.source === "bundled") return { success: false, error: "Bundled plugins can be turned off, not removed" };
    // Others that need this one (by the directory's requires lists).
    const neededBy = index.plugins
      .filter(p => p.requires.includes(id) && installedMap().has(p.id) && !readPending(userData).remove[p.id])
      .map(p => p.name);
    const result = stageRemove(userData, id, { deleteData });
    return { success: true, cancelled: result.cancelled, neededBy };
  }

  return {
    refresh,
    getState,
    install,
    updateAll,
    importPackage,
    remove,
    cancel: (id) => cancelPending(userData, id),
    setMoved,
    dismissMoved,
    resolveInstallSet,
  };
}

module.exports = {
  DEFAULT_INDEX_URL,
  INSTALLED_DIR,
  PENDING_DIR,
  compareVersions,
  parseVersion,
  VERSION_PATTERN,
  parseIndex,
  readRegistry,
  readPending,
  applyPending,
  migrateLegacyImports,
  moveDirSync,
  cleanupStaleTemp,
  stagePackage,
  stageRemove,
  cancelPending,
  findMovedPlugins,
  readMovedHandled,
  readSetupState,
  writeSetupState,
  needsPluginSetup,
  createPluginDirectory,
};
