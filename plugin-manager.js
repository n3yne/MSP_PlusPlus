"use strict";

const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { EventEmitter } = require("events");
const { pathToFileURL } = require("url");

const { version: APP_VERSION } = require("./package.json");
const SiteColors = require("./site-colors");
const PluginDirectory = require("./plugin-directory");
const PluginCategories = require("./plugin-categories");
const safeFile = require("./safe-file");

const pluginBus = new EventEmitter();
pluginBus.setMaxListeners(100);

// All IPC channels registered by plugins — checked at handle() time to prevent duplicates.
const registeredChannels = new Set();

// Absolute renderer script paths collected during initPlugins.
const rendererScripts = [];

// Settings-window scripts collected during initPlugins: { id, path }.
const settingsScripts = [];

// Absolute stylesheet paths collected during initPlugins (loaded in both windows).
const pluginStylesheets = [];

// Merged default settings from all loaded plugins — filled during initPlugins.
const _pluginDefaultSettings = {};
// Settings validators from plugins — each { pluginId, fn }.
const _pluginValidators = [];
// Settings transformers from plugins — each { pluginId, fn } — called before writing to disk.
const _settingsTransformers = [];
// Settings migrators from plugins — each { pluginId, fn } — mutate raw parsed object in-place.
const _migrators = [];

// All plugins discovered during initPlugins (including disabled and failed).
const _discoveredPlugins = [];
// Credential settings declared in plugin manifests ("credentials": ["myApiKey"]).
// Collected from disabled plugins too, so their stored keys stay protected.
const _credentialFields = [];
const CREDENTIAL_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,40}$/;
// Settings a plugin wants pointed out before a settings import changes them
// (manifest "sensitiveSettings": { "settingName": "Label shown to the user" }),
// such as one that sends page loads to another host. { key, label, pluginId }.
const _sensitiveSettings = [];
const MAX_SENSITIVE_SETTINGS = 10;

// Sites declared by loaded plugins in their manifests ("site": { ... }) — see docs/sites.md.
// Core uses them for the things it has to do before any page loads: the home page
// default, the user-agent override and which sign-in popups open as real windows.
const _sites = [];
const MAX_SITE_HOSTS = 20;
// A bare domain such as "freshservice.com" or "eu.myconnectwise.net": matches that
// host and every subdomain of it. No scheme, port, path or wildcard.
const SITE_HOST_PATTERN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Extra hosts plugins add to their own site at run time (api.setSiteHosts), e.g. the
// address of a self-hosted server from a setting: pluginId → [host]. Unlike manifest
// hosts these match exactly (no subdomains) and may be a single label or an IPv4
// address. Checked against the loaded sites when read (siteExtraHosts), because a
// plugin's site block is only recorded after its init() has run.
const _siteHostRequests = new Map();
const MAX_EXTRA_SITE_HOSTS = 10;
const EXTRA_SITE_HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
// Called with no arguments whenever a plugin changes its extra hosts (main.js
// re-installs the user-agent override).
let _siteHostsListener = null;

// Plugin enable/disable config: { "plugin-id": false } — only entries for disabled plugins.
// Missing key = enabled by default.
let _pluginsConfig = {};
let _pluginsConfigFile = null;

// Absolute path to the userData directory (set during initPlugins).
let _userData = null;

// Live copy of settings — updated on each save-settings call.
let _currentSettings = {};

// Menu contributions from plugins: { label, accelerator?, click }
const _menuContributions = [];
const MAX_MENU_ITEMS = 10;

// Callback to rebuild the app menu with plugin contributions.
let _rebuildMenu = null;

// Host redirects asked for by plugins (api.setHostRedirects): pluginId → [{ from, to }].
// Checked against the loaded sites when read (getHostRedirects), because a plugin's
// site block is only recorded after its init() has run.
const _hostRedirectRequests = new Map();
const MAX_HOST_REDIRECTS = 10;
// Sign-in and identity hosts no plugin may redirect away from, whatever its
// settings say: a redirect from one of these could hand a sign-in page to
// someone else's site. Matches the host and its subdomains.
const PROTECTED_REDIRECT_SOURCES = [
  "microsoftonline.com", "microsoft.com", "live.com", "windows.net", "microsoftonline.us",
  "office.com", "office365.com", "msauth.net", "msftauth.net",
  "google.com", "googleapis.com", "apple.com", "icloud.com",
  "okta.com", "oktapreview.com", "duosecurity.com", "onelogin.com", "auth0.com",
  "pingidentity.com", "pingone.com", "jumpcloud.com", "github.com",
];
// Called with no arguments whenever a plugin changes its redirects (main.js re-installs them).
let _hostRedirectsListener = null;

// ===================== Semver helpers =====================

function parseSemver(str) {
  const m = String(str || "0.0.0").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}

function semverLt(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return true;
    if (pa[i] > pb[i]) return false;
  }
  return false;
}

// ===================== Config persistence =====================

async function loadPluginsConfig() {
  if (!_pluginsConfigFile) return;
  // A damaged file falls back to plugins-config.json.bak (the last good save).
  try {
    const res = await safeFile.readJsonFile(_pluginsConfigFile);
    _pluginsConfig = res.value && typeof res.value === "object" && !Array.isArray(res.value) ? res.value : {};
  } catch {
    _pluginsConfig = {};
  }
}

async function savePluginsConfig() {
  if (!_pluginsConfigFile) return;
  try {
    await safeFile.writeJsonWithBackup(_pluginsConfigFile, _pluginsConfig);
  } catch (err) {
    console.error("[PluginManager] Failed to save plugins config:", err);
  }
}

// ===================== Sites =====================

// Validates a manifest "site" block. Returns a clean copy, or null (with a warning)
// when the block is unusable.
function parseSiteManifest(pluginId, site) {
  if (site === undefined) return null;
  if (!site || typeof site !== "object" || Array.isArray(site)) {
    console.warn(`[PluginManager] Plugin "${pluginId}" has an invalid "site" block — ignored`);
    return null;
  }
  const hosts = [];
  for (const h of Array.isArray(site.hosts) ? site.hosts : []) {
    const host = typeof h === "string" ? h.trim().toLowerCase() : "";
    if (!SITE_HOST_PATTERN.test(host)) {
      console.warn(`[PluginManager] Plugin "${pluginId}" site host "${h}" is not a bare domain — skipped`);
      continue;
    }
    if (!hosts.includes(host) && hosts.length < MAX_SITE_HOSTS) hosts.push(host);
  }
  let defaultUrl = "";
  if (typeof site.defaultUrl === "string" && site.defaultUrl.length <= 2048) {
    try {
      const u = new URL(site.defaultUrl);
      if (u.protocol === "https:" || u.protocol === "http:") defaultUrl = u.href;
    } catch { /* invalid — left empty */ }
  }
  const name = typeof site.name === "string" && site.name.trim() ? site.name.trim().slice(0, 60) : pluginId;
  return {
    pluginId,
    name,
    shortName: typeof site.shortName === "string" && site.shortName.trim() ? site.shortName.trim().slice(0, 20) : name,
    hosts,
    defaultUrl,
    chromeUserAgent: site.chromeUserAgent === true,
    color: SiteColors.normalizeColor(site.color),
  };
}

// True when hostname is one of the site's hosts or a subdomain of one.
function hostMatchesSite(hostname, site) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return site.hosts.some(h => host === h || host.endsWith("." + h));
}

// The extra hosts (api.setSiteHosts) each loaded site actually gets: pluginId → [host].
// A plugin without a site block gets none, a host on another plugin's site hosts is
// skipped (so a plugin can't take over another site), and the first plugin to
// claim a host keeps it.
function siteExtraHosts() {
  const out = new Map();
  const taken = new Set();
  for (const [pluginId, hosts] of _siteHostRequests) {
    if (!_sites.some(si => si.pluginId === pluginId)) continue;
    const mine = [];
    for (const host of hosts) {
      if (taken.has(host)) continue;
      if (_sites.some(si => si.pluginId !== pluginId && hostMatchesSite(host, si))) {
        console.warn(`[PluginManager] Plugin "${pluginId}" extra site host "${host}" belongs to another site — skipped`);
        continue;
      }
      taken.add(host);
      mine.push(host);
    }
    if (mine.length) out.set(pluginId, mine);
  }
  return out;
}

// A copy of a site for callers, with its current extra hosts.
function siteWithExtraHosts(site, extra) {
  return Object.assign({}, site, {
    hosts: site.hosts.slice(),
    extraHosts: (extra.get(site.pluginId) || []).slice(),
  });
}

function setSiteHostsListener(fn) {
  _siteHostsListener = typeof fn === "function" ? fn : null;
}

// ===================== Host redirects =====================

// Pairs a plugin may actually use: both hosts bare domains, `to` on one of that
// plugin's own site hosts, and `from` on nobody's site hosts (so a plugin can't
// take over another site, or redirect its own pages in a loop), and not a
// sign-in host (PROTECTED_REDIRECT_SOURCES).
function validHostRedirects(pluginId) {
  const own = _sites.find(si => si.pluginId === pluginId);
  if (!own) return [];
  const extraHosts = [].concat(...siteExtraHosts().values());
  const out = [];
  for (const r of _hostRedirectRequests.get(pluginId) || []) {
    if (hostMatchesSite(r.from, { hosts: PROTECTED_REDIRECT_SOURCES })) {
      console.warn(`[PluginManager] Plugin "${pluginId}" redirect from "${r.from}" is a sign-in host — skipped`);
      continue;
    }
    if (_sites.some(si => hostMatchesSite(r.from, si)) || extraHosts.includes(r.from)) {
      console.warn(`[PluginManager] Plugin "${pluginId}" redirect from "${r.from}" is a site host — skipped`);
      continue;
    }
    if (!hostMatchesSite(r.to, own)) {
      console.warn(`[PluginManager] Plugin "${pluginId}" redirect to "${r.to}" is not one of its site hosts — skipped`);
      continue;
    }
    out.push({ from: r.from, to: r.to, pluginId });
  }
  return out;
}

// [{ from, to, pluginId }] for every loaded plugin. The first plugin to claim a
// `from` host keeps it.
function getHostRedirects() {
  const out = [];
  for (const pluginId of _hostRedirectRequests.keys()) {
    for (const r of validHostRedirects(pluginId)) {
      if (!out.some(o => o.from === r.from)) out.push(r);
    }
  }
  return out;
}

function setHostRedirectsListener(fn) {
  _hostRedirectsListener = typeof fn === "function" ? fn : null;
}

// The address to send a page load to instead of `url`, or null to leave it alone.
// Only the host changes (to https, without a port or credentials); path, query and
// fragment are kept. Only exact host matches redirect, not subdomains.
function redirectUrlFor(url, redirects) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  const r = (redirects || []).find(x => x.from === host);
  if (!r) return null;
  u.protocol = "https:";
  u.username = "";
  u.password = "";
  u.port = "";
  u.hostname = r.to;
  return u.href;
}

// ===================== Plugin API factory =====================

function buildPluginApi(pluginId, ipcMain) {
  const dataDir = path.join(_userData, "plugins", pluginId);

  return Object.freeze({
    handle(action, asyncFn) {
      if (!/^[a-z0-9_-]+$/i.test(action)) {
        console.warn(`[Plugin:${pluginId}] Skipped handle("${action}"): invalid action name`);
        return;
      }
      const channel = `plugin:${pluginId}:${action}`;
      if (registeredChannels.has(channel)) {
        console.warn(`[Plugin:${pluginId}] Duplicate handler for "${action}" — skipped`);
        return;
      }
      registeredChannels.add(channel);
      ipcMain.handle(channel, async (_event, data) => {
        try {
          return await asyncFn(data);
        } catch (err) {
          console.error(`[Plugin:${pluginId}] Error in handler "${action}":`, err);
          throw err;
        }
      });
    },

    // Fire-and-forget messages from renderer code (pluginAPI.send). Unlike handle(),
    // nothing is returned, but the message is still delivered while the window is
    // closing, so fn can save state synchronously during beforeunload.
    onMessage(action, fn) {
      if (!/^[a-z0-9_-]+$/i.test(action) || typeof fn !== "function") {
        console.warn(`[Plugin:${pluginId}] Skipped onMessage("${action}"): invalid action name or handler`);
        return;
      }
      const channel = `plugin-msg:${pluginId}:${action}`;
      if (registeredChannels.has(channel)) {
        console.warn(`[Plugin:${pluginId}] Duplicate message handler for "${action}" — skipped`);
        return;
      }
      registeredChannels.add(channel);
      ipcMain.on(channel, (_event, data) => {
        try { fn(data); } catch (err) {
          console.error(`[Plugin:${pluginId}] Error in message handler "${action}":`, err);
        }
      });
    },

    // Publishes an event to main-process plugins (api.on), e.g. note:saved.
    emit(eventName, data) {
      if (typeof eventName !== "string" || !eventName) return;
      pluginBus.emit(eventName, data);
    },

    on(eventName, fn) {
      pluginBus.on(eventName, function (data) {
        try { fn(data); } catch (err) {
          console.error(`[Plugin:${pluginId}] Error in event "${eventName}":`, err);
        }
      });
    },

    getDataPath() {
      fs.mkdirSync(dataDir, { recursive: true });
      return dataDir;
    },

    getSettings() {
      return Object.freeze(Object.assign({}, _currentSettings));
    },

    addMenuItem(opts) {
      if (!opts || typeof opts.label !== "string") return;
      if (_menuContributions.length >= MAX_MENU_ITEMS) {
        console.warn(`[Plugin:${pluginId}] Menu item limit (${MAX_MENU_ITEMS}) reached`);
        return;
      }
      _menuContributions.push({
        label: opts.label,
        accelerator: opts.accelerator || undefined,
        click: typeof opts.click === "function" ? opts.click : () => {},
        pluginId,
      });
      if (_rebuildMenu) _rebuildMenu(_menuContributions);
    },

    log(...args) {
      console.log(`[Plugin:${pluginId}]`, ...args);
    },

    encryptCredential(plaintext) {
      if (typeof plaintext !== "string" || !plaintext) return null;
      try {
        const electron = require("electron");
        if (!electron.safeStorage.isEncryptionAvailable()) return null;
        return electron.safeStorage.encryptString(plaintext).toString("base64");
      } catch { return null; }
    },

    decryptCredential(encrypted) {
      if (typeof encrypted !== "string" || !encrypted) return null;
      try {
        const electron = require("electron");
        if (!electron.safeStorage.isEncryptionAvailable()) return null;
        return electron.safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch { return null; }
    },

    // Sends page loads (top-level GET navigations) on one host to another, keeping
    // the path, query and fragment, e.g. a company alias of a helpdesk to its real
    // host. Each call replaces this plugin's list; [] turns them off. `to` must be
    // on this plugin's site hosts. API calls made with fetch() in main.js are not
    // affected.
    setHostRedirects(list) {
      const clean = [];
      for (const r of Array.isArray(list) ? list : []) {
        const from = r && typeof r.from === "string" ? r.from.trim().toLowerCase() : "";
        const to = r && typeof r.to === "string" ? r.to.trim().toLowerCase() : "";
        if (!SITE_HOST_PATTERN.test(from) || !SITE_HOST_PATTERN.test(to) || from === to) {
          console.warn(`[Plugin:${pluginId}] setHostRedirects: skipped invalid pair ${JSON.stringify(r)}`);
          continue;
        }
        if (clean.length >= MAX_HOST_REDIRECTS) break;
        if (!clean.some(c => c.from === from)) clean.push({ from, to });
      }
      if (clean.length) _hostRedirectRequests.set(pluginId, clean);
      else _hostRedirectRequests.delete(pluginId);
      if (_hostRedirectsListener) {
        try { _hostRedirectsListener(); } catch (err) {
          console.error("[PluginManager] Host redirect listener threw:", err);
        }
      }
    },

    // Adds hosts to this plugin's own site (its manifest "site" block) at run time,
    // e.g. a self-hosted server's address from a setting. Pages on them get what
    // the manifest hosts get from core: the Chrome user agent (when the site asks
    // for it) and sign-in popups as real windows. Each call replaces this plugin's
    // list; [] removes them. Exact hosts only, not their subdomains.
    setSiteHosts(list) {
      const clean = [];
      for (const h of Array.isArray(list) ? list : []) {
        const host = typeof h === "string" ? h.trim().toLowerCase() : "";
        if (!EXTRA_SITE_HOST_PATTERN.test(host)) {
          console.warn(`[Plugin:${pluginId}] setSiteHosts: skipped invalid host ${JSON.stringify(h)}`);
          continue;
        }
        if (clean.length >= MAX_EXTRA_SITE_HOSTS) break;
        if (!clean.includes(host)) clean.push(host);
      }
      if (clean.length) _siteHostRequests.set(pluginId, clean);
      else _siteHostRequests.delete(pluginId);
      // A host that became a site host can no longer be redirected, so both are refreshed.
      for (const listener of [_siteHostsListener, _hostRedirectsListener]) {
        if (!listener) continue;
        try { listener(); } catch (err) {
          console.error("[PluginManager] Site hosts listener threw:", err);
        }
      }
    },

    registerSettingsTransformer(fn) {
      if (typeof fn !== "function") {
        console.warn(`[Plugin:${pluginId}] registerSettingsTransformer: argument must be a function`);
        return;
      }
      _settingsTransformers.push({ pluginId, fn });
    },
  });
}

// ===================== Plugin loading =====================

// Resolves a manifest-supplied relative path and validates it stays within pluginDir.
// Returns the absolute path, or null if the entry attempts to escape the directory.
function safePluginPath(pluginDir, entry) {
  if (!entry || typeof entry !== "string") return null;
  const resolved = path.resolve(pluginDir, entry);
  const base = pluginDir.endsWith(path.sep) ? pluginDir : pluginDir + path.sep;
  return resolved.startsWith(base) ? resolved : null;
}

async function loadPlugin(pluginDir, source, ipcMain) {
  // Parse manifest
  let manifest;
  try {
    const raw = await fsp.readFile(path.join(pluginDir, "manifest.json"), "utf-8");
    manifest = JSON.parse(raw);
  } catch {
    console.warn(`[PluginManager] Skipping "${pluginDir}": missing or invalid manifest.json`);
    return;
  }

  // Validate id
  if (!manifest.id || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(manifest.id)) {
    console.warn(`[PluginManager] Skipping "${pluginDir}": invalid or missing id`);
    return;
  }

  const id = manifest.id;
  const enabled = _pluginsConfig[id] !== false;

  // Record discovery before attempting to load
  const record = {
    id,
    name: manifest.name || id,
    version: manifest.version || "",
    description: manifest.description || "",
    category: PluginCategories.normalizeCategory(manifest.category),
    source,         // "bundled" | "directory" | "imported" (a file, folder or unknown source)
    dir: pluginDir,
    enabled,
    loaded: false,
    loadError: null,
    credentials: [],
    hasSettings: typeof manifest.settings === "string" && manifest.settings.length > 0,
    site: null,
    replacesBundled: "",
  };
  _discoveredPlugins.push(record);

  const credentials = Array.isArray(manifest.credentials) ? manifest.credentials : [];
  for (const name of credentials) {
    if (typeof name !== "string" || !CREDENTIAL_NAME_PATTERN.test(name)) {
      console.warn(`[PluginManager] Plugin "${id}" declares an invalid credential name — skipped`);
      continue;
    }
    record.credentials.push(name);
    if (_credentialFields.some(c => c.plain === name)) continue;
    _credentialFields.push({
      plain: name,
      encrypted: name + "Encrypted",
      flag: name + "Set",
      remove: name + "Remove",
    });
  }

  const sensitive = manifest.sensitiveSettings;
  if (sensitive && typeof sensitive === "object" && !Array.isArray(sensitive)) {
    for (const [key, label] of Object.entries(sensitive).slice(0, MAX_SENSITIVE_SETTINGS)) {
      if (!/^[a-z][A-Za-z0-9]{0,60}$/.test(key) || typeof label !== "string" || !label.trim()) continue;
      if (_sensitiveSettings.some(x => x.key === key)) continue;
      _sensitiveSettings.push({ key, label: label.trim().slice(0, 80), pluginId: id });
    }
  }

  if (!enabled) {
    return; // Skip load — disabled by user
  }

  // Version check
  if (manifest.minAppVersion && semverLt(APP_VERSION, manifest.minAppVersion)) {
    record.loadError = `Requires app >= ${manifest.minAppVersion}`;
    console.warn(`[PluginManager] Skipping plugin "${id}": ${record.loadError} (running ${APP_VERSION})`);
    return;
  }

  // Load main-process entry
  if (manifest.main) {
    const mainPath = safePluginPath(pluginDir, manifest.main);
    if (!mainPath) {
      record.loadError = "Invalid main entry point path";
      console.warn(`[PluginManager] Skipping plugin "${id}" main: path traversal detected`);
      return;
    }
    try {
      const mod = require(mainPath);
      const api = buildPluginApi(id, ipcMain);
      if (typeof mod === "function") {
        mod(api);
      } else if (mod && typeof mod.init === "function") {
        mod.init(api);
      } else if (!mod?.defaultSettings && !mod?.validateSettings) {
        console.warn(`[PluginManager] Plugin "${id}" main.js does not export a function, { init }, or plugin metadata`);
      }
      // Collect plugin-provided settings metadata (defaultSettings, validateSettings)
      if (mod?.defaultSettings && typeof mod.defaultSettings === "object" && !Array.isArray(mod.defaultSettings)) {
        Object.assign(_pluginDefaultSettings, mod.defaultSettings);
      }
      if (typeof mod?.validateSettings === "function") {
        _pluginValidators.push({ pluginId: id, fn: mod.validateSettings });
      }
      if (typeof mod?.migrateSettings === "function") {
        _migrators.push({ pluginId: id, fn: mod.migrateSettings });
      }
      console.log(`[PluginManager] Loaded plugin "${id}" (main)`);
    } catch (err) {
      record.loadError = err.message || String(err);
      console.error(`[PluginManager] Failed to load plugin "${id}" main.js:`, err);
      return; // Don't add renderer script if main failed
    }
  }

  // Record renderer entry
  if (manifest.renderer) {
    const rendererPath = safePluginPath(pluginDir, manifest.renderer);
    if (!rendererPath) {
      console.warn(`[PluginManager] Plugin "${id}" renderer: path traversal detected — skipped`);
    } else {
      try {
        await fsp.access(rendererPath, fs.constants.R_OK);
        rendererScripts.push(rendererPath);
        if (!manifest.main) {
          console.log(`[PluginManager] Loaded plugin "${id}" (renderer only)`);
        }
      } catch {
        console.warn(`[PluginManager] Plugin "${id}" renderer file not found: ${rendererPath}`);
      }
    }
  }

  // Record settings-window entry
  if (manifest.settings) {
    const settingsPath = safePluginPath(pluginDir, manifest.settings);
    if (!settingsPath) {
      console.warn(`[PluginManager] Plugin "${id}" settings: path traversal detected — skipped`);
    } else {
      try {
        await fsp.access(settingsPath, fs.constants.R_OK);
        settingsScripts.push({ id, path: settingsPath });
      } catch {
        console.warn(`[PluginManager] Plugin "${id}" settings file not found: ${settingsPath}`);
      }
    }
  }

  // Auto-load styles.css if present — injected into both windows
  const stylesPath = path.join(pluginDir, "styles.css");
  try {
    await fsp.access(stylesPath, fs.constants.R_OK);
    pluginStylesheets.push(stylesPath);
  } catch { /* no styles.css — fine */ }

  record.loaded = true;

  // Only a plugin that loaded gets to shape core behaviour for its site.
  const site = parseSiteManifest(id, manifest.site);
  if (site) {
    record.site = site;
    _sites.push(site);
  }
}

// ===================== Public API =====================

// Every plugin folder to load, one per plugin id. Plugins come from two places:
//   <app>/plugins/<id>                 bundled with the app
//   <data>/installed-plugins/<id>      installed from the plugin directory or a file
// Plugins imported before 0.8 lived in their data folder (<data>/plugins/<id>);
// applyPending moves them to installed-plugins, and code never loads from a data
// folder. When the same id is in both places, the newer version wins, and a tie
// goes to the bundled copy. So a fixed bundled plugin can be shipped through the
// directory before the next app release.
async function findPluginFolders(userData) {
  const registry = PluginDirectory.readRegistry(userData);
  const searchDirs = [
    { dir: path.join(__dirname, "plugins"), source: () => "bundled" },
    {
      dir: path.join(userData, PluginDirectory.INSTALLED_DIR),
      // Only an install the registry says came from the directory counts as one;
      // anything else (imported, or a folder copied in by hand) is "imported".
      source: (id) => (registry[id] && registry[id].source === "directory" ? "directory" : "imported"),
    },
  ];

  const candidates = [];
  for (const { dir, source } of searchDirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist — skip silently
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const pluginDir = path.join(dir, entry.name);
      let manifest = null;
      try {
        manifest = JSON.parse(await fsp.readFile(path.join(pluginDir, "manifest.json"), "utf-8"));
      } catch { /* no manifest: broken — loadPlugin logs it */ }
      candidates.push({
        pluginDir,
        id: manifest && typeof manifest.id === "string" ? manifest.id : null,
        version: manifest && typeof manifest.version === "string" ? manifest.version : "",
        source: source(manifest && manifest.id),
      });
    }
  }

  const winners = new Map();
  const order = [];
  for (const c of candidates) {
    if (!c.id) { order.push(c); continue; }
    const current = winners.get(c.id);
    if (!current) {
      winners.set(c.id, c);
      order.push(c);
      continue;
    }
    if (PluginDirectory.compareVersions(c.version, current.version) > 0) {
      console.warn(`[PluginManager] Plugin "${c.id}" ${c.version} (${c.source}) replaces ${current.version} (${current.source})`);
      if (current.source === "bundled") c.replacesBundled = current.version || "?";
      order[order.indexOf(current)] = c;
      winners.set(c.id, c);
    } else {
      console.warn(`[PluginManager] Skipped plugin "${c.id}" ${c.version} (${c.source}): ${current.version} (${current.source}) is loaded instead`);
    }
  }
  return order;
}

async function initPlugins(userData, initialSettings, ipcMain, rebuildMenuFn) {
  _userData = userData;
  _currentSettings = Object.assign({}, initialSettings);
  _rebuildMenu = rebuildMenuFn || null;
  _pluginsConfigFile = path.join(userData, "note-backups", "plugins-config.json");
  _discoveredPlugins.length = 0; // Clear on re-init
  _credentialFields.length = 0;
  _sensitiveSettings.length = 0;
  _sites.length = 0;
  for (const key of Object.keys(_pluginDefaultSettings)) delete _pluginDefaultSettings[key];
  _pluginValidators.length = 0;
  _settingsTransformers.length = 0;
  _migrators.length = 0;
  _hostRedirectRequests.clear();
  _siteHostRequests.clear();

  await loadPluginsConfig();

  // Installs, updates and removals from Settings > Plugins wait for a restart;
  // apply them before anything loads.
  try {
    PluginDirectory.applyPending(userData);
  } catch (err) {
    console.error("[PluginManager] Applying plugin changes failed:", err);
  }

  for (const { pluginDir, source, replacesBundled } of await findPluginFolders(userData)) {
    await loadPlugin(pluginDir, source, ipcMain);
    if (replacesBundled) {
      const record = _discoveredPlugins[_discoveredPlugins.length - 1];
      if (record && record.dir === pluginDir) record.replacesBundled = replacesBundled;
    }
  }

  // The first site with a start page seeds the home page default. A plugin's own
  // defaultSettings.defaultUrl, if any, wins.
  const startSite = _sites.find(si => si.defaultUrl);
  if (startSite && _pluginDefaultSettings.defaultUrl === undefined) {
    _pluginDefaultSettings.defaultUrl = startSite.defaultUrl;
  }

  pluginBus.emit("app:ready", {});
}

function getRendererScripts() {
  // Return file:// URLs so the renderer can use them as <script src>.
  // pathToFileURL percent-encodes characters such as # and % in the install path.
  return rendererScripts.map(p => pathToFileURL(p).href);
}

// [{ id, url }] — the settings window tags each script with its plugin id, so the
// panels a script adds can be matched to their plugin.
function getSettingsScripts() {
  return settingsScripts.map(s => ({ id: s.id, url: pathToFileURL(s.path).href }));
}

function getPluginStylesheets() {
  return pluginStylesheets.map(p => pathToFileURL(p).href);
}

function getPluginInfo() {
  return _discoveredPlugins.map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    category: p.category,
    source: p.source,
    enabled: p.enabled,
    loaded: p.loaded,
    loadError: p.loadError,
    credentials: p.credentials.slice(),
    hasSettings: p.hasSettings,
    site: p.site ? Object.assign({}, p.site, { hosts: p.site.hosts.slice() }) : null,
    replacesBundled: p.replacesBundled || "",
  }));
}

// [{ pluginId, name, shortName, hosts, extraHosts, defaultUrl, chromeUserAgent, color }]
// for loaded site plugins. `hosts` (from the manifest) match their subdomains too;
// `extraHosts` (api.setSiteHosts) match exactly.
function getSites() {
  const extra = siteExtraHosts();
  return _sites.map(si => siteWithExtraHosts(si, extra));
}

// The loaded site this URL's hostname belongs to (a manifest host, a subdomain
// of one, or exactly an extra host), or null.
function findSiteForUrl(url) {
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return null; }
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const extra = siteExtraHosts();
  const site = _sites.find(si => hostMatchesSite(host, si)) ||
    _sites.find(si => (extra.get(si.pluginId) || []).includes(host));
  return site ? siteWithExtraHosts(site, extra) : null;
}

async function setPluginEnabled(id, enabled) {
  if (enabled) {
    delete _pluginsConfig[id]; // Enabled is the default — remove the entry
  } else {
    _pluginsConfig[id] = false;
  }
  await savePluginsConfig();

  // Update in-memory record
  const plugin = _discoveredPlugins.find(p => p.id === id);
  if (plugin) plugin.enabled = enabled;
}

function fireEvent(name, data) {
  pluginBus.emit(name, data);
}

function updateSettings(settings) {
  _currentSettings = Object.assign({}, settings);
}

function runMigrations(rawSettings) {
  for (const { pluginId, fn } of _migrators) {
    try {
      fn(rawSettings);
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" migrateSettings threw:`, err);
    }
  }
}

// Returns [{ plain, encrypted, flag, remove }] for every credential setting a plugin declares.
function getCredentialFields() {
  return _credentialFields.map(c => Object.assign({}, c));
}

// [{ key, label, pluginId }] from manifests' "sensitiveSettings" (disabled plugins included).
function getSensitiveSettings() {
  return _sensitiveSettings.map(x => Object.assign({}, x));
}

function getPluginDefaultSettings() {
  return Object.assign({}, _pluginDefaultSettings);
}

function validatePluginSettings(s) {
  for (const { pluginId, fn } of _pluginValidators) {
    try {
      if (!fn(s)) {
        console.warn(`[PluginManager] Plugin "${pluginId}" validateSettings rejected the payload`);
        return false;
      }
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" validateSettings threw:`, err);
      return false;
    }
  }
  return true;
}

function transformSettingsForSave(settings) {
  let result = Object.assign({}, settings);
  for (const { pluginId, fn } of _settingsTransformers) {
    try {
      const out = fn(result);
      if (out && typeof out === "object" && !Array.isArray(out)) result = out;
    } catch (err) {
      console.error(`[PluginManager] Plugin "${pluginId}" settings transformer threw:`, err);
    }
  }
  return result;
}

module.exports = {
  initPlugins,
  getRendererScripts,
  getSettingsScripts,
  getPluginStylesheets,
  getPluginInfo,
  setPluginEnabled,
  findPluginFolders,
  fireEvent,
  updateSettings,
  runMigrations,
  getPluginDefaultSettings,
  validatePluginSettings,
  transformSettingsForSave,
  getCredentialFields,
  getSensitiveSettings,
  getSites,
  findSiteForUrl,
  getHostRedirects,
  setHostRedirectsListener,
  setSiteHostsListener,
  redirectUrlFor,
  parseSiteManifest,
};
