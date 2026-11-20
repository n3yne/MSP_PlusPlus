"use strict";

// Shared between main process (required directly) and tests.
// Contains only core app settings. Plugin-specific defaults and validators
// live in each plugin's main.js (defaultSettings + validateSettings exports).

const SiteColors = require("../shared/site-colors");
const SidePanelSplit = require("../shared/side-panel-split");

const DEFAULT_SETTINGS = {
  sidePanelEnabled: true,
  panelCollapsed: false,
  sidePanelTab: "",
  // Side panel tab strip: false wraps the tabs onto more rows, true keeps one
  // row that scrolls sideways (arrow buttons and the mouse wheel).
  sidePanelTabScroll: false,
  // Side panel split view: tabs moved to the bottom half (right-click a tab),
  // the bottom half's selected tab, and the top half's share of the height.
  sidePanelBottomTabs: [],
  sidePanelBottomTab: "",
  sidePanelSplit: SidePanelSplit.DEFAULT_SPLIT,
  // The first site plugin's start page replaces this (manifest "site.defaultUrl");
  // with no site plugin loaded, new tabs open blank.
  defaultUrl: "about:blank",
  theme: "dark",
  dismissedReleaseVersion: "",
  // Installed Windows build: download new versions in the background and install
  // them when the app closes. Off: ask before downloading. See updater.js.
  autoUpdate: true,
  // Reopen the tabs that were open when the app last closed. Off: start on the
  // Home URL. Pinned tabs come back either way.
  restoreTabs: true,
  // Mark a background tab with a dot when its page changes on its own (a new
  // reply changes the title or favicon), until the tab is viewed.
  unreadTabBadges: true,
  // Coloured stripe on tabs of site plugins (Freshservice, ConnectWise). Per-site
  // colours the user picked live in siteTabColorOverrides; see site-colors.js.
  siteTabColors: true,
  // Plugins installed from the plugin directory: download updates by themselves
  // (applied at the next start). Off: show them in Settings > Plugins > Browse
  // and the notifications list. See plugin-directory.js.
  pluginAutoUpdate: false,
  // Middle-click or Ctrl+click on a link in a page: true opens the new tab in the
  // background and stays on the current tab (like Chrome). False switches to it.
  linkClickBackground: false,
  // Windows opened with "Open in New Window" stay above other windows.
  popOutAlwaysOnTop: false,
};

function validateSettings(s) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  if (typeof s.sidePanelEnabled !== "boolean") return false;
  if (typeof s.panelCollapsed !== "boolean") return false;
  if (s.sidePanelTab !== undefined && (typeof s.sidePanelTab !== "string" || s.sidePanelTab.length > 64)) return false;
  if (typeof s.defaultUrl !== "string" || s.defaultUrl.length === 0 || s.defaultUrl.length > 2048) return false;
  if (s.defaultUrl !== "about:blank") {
    try {
      const parsed = new URL(s.defaultUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    } catch { return false; }
  }
  if (!["dark", "light"].includes(s.theme)) return false;
  if (s.sidePanelTabScroll !== undefined && typeof s.sidePanelTabScroll !== "boolean") return false;
  if (s.sidePanelBottomTabs !== undefined && !SidePanelSplit.validBottomTabs(s.sidePanelBottomTabs)) return false;
  if (s.sidePanelBottomTab !== undefined && (typeof s.sidePanelBottomTab !== "string" || s.sidePanelBottomTab.length > 64)) return false;
  if (s.sidePanelSplit !== undefined && !SidePanelSplit.validSplit(s.sidePanelSplit)) return false;
  if (s.autoUpdate !== undefined && typeof s.autoUpdate !== "boolean") return false;
  if (s.restoreTabs !== undefined && typeof s.restoreTabs !== "boolean") return false;
  if (s.unreadTabBadges !== undefined && typeof s.unreadTabBadges !== "boolean") return false;
  if (s.siteTabColors !== undefined && typeof s.siteTabColors !== "boolean") return false;
  if (s.pluginAutoUpdate !== undefined && typeof s.pluginAutoUpdate !== "boolean") return false;
  if (s.linkClickBackground !== undefined && typeof s.linkClickBackground !== "boolean") return false;
  if (s.popOutAlwaysOnTop !== undefined && typeof s.popOutAlwaysOnTop !== "boolean") return false;
  if (!SiteColors.validOverrides(s.siteTabColorOverrides)) return false;
  if (s.dismissedReleaseVersion !== undefined && (typeof s.dismissedReleaseVersion !== "string" || s.dismissedReleaseVersion.length > 20)) return false;
  return true;
}

// Upgrades settings saved by older versions, in place. Run once at startup on
// the raw settings file. Returns the same object.
function migrateCoreSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  // 0.5.6: "Note Backup Side Panel" became the shared "Side Panel".
  if (Object.prototype.hasOwnProperty.call(raw, "notePanelEnabled")) {
    if (typeof raw.sidePanelEnabled !== "boolean" && typeof raw.notePanelEnabled === "boolean") {
      raw.sidePanelEnabled = raw.notePanelEnabled;
    }
    delete raw.notePanelEnabled;
  }
  return raw;
}

// Which saved tabs to open at startup, from open-tabs.json's entries (old
// builds saved bare URL strings) and the restoreTabs setting. Returns
// { tabs: [{ url, pinned }], openHome } where openHome means also open a Home
// URL tab and show it, because the last session's other tabs were left closed.
function tabsToRestore(saved, restoreTabs) {
  const list = (Array.isArray(saved) ? saved : [])
    .map((item) => (typeof item === "string" ? { url: item, pinned: false } : item))
    .filter((item) => item && typeof item.url === "string" && item.url)
    .map((item) => ({ url: item.url, pinned: item.pinned === true }));
  if (restoreTabs !== false) return { tabs: list, openHome: list.length === 0 };
  return { tabs: list.filter((t) => t.pinned), openHome: true };
}

// The app was called Freshservice++ before it became MSP++. Electron names the
// data folder after the app, so after the rename it would look in a new, empty
// folder and existing users would lose their settings, notes, open tabs and
// site sign-ins. Returns the old folder to keep using when the new one has no
// data yet and an old one does, otherwise null. Data stays where it is, so an
// older build pointed at the same folder still works.
const LEGACY_DATA_DIR_NAMES = ["Freshservice++", "freshservice-pp"];

function findLegacyUserDataDir(appDataDir, currentDir, exists, join) {
  const hasData = (dir) => exists(join(dir, "note-backups"));
  if (hasData(currentDir)) return null;
  for (const name of LEGACY_DATA_DIR_NAMES) {
    const legacy = join(appDataDir, name);
    if (legacy !== currentDir && hasData(legacy)) return legacy;
  }
  return null;
}

// When a settings save fails validation, the problem may be a value already
// stored (say, written by an older version), not the change being saved; then
// every later save would fail too. This resets stored keys the change didn't
// touch, one at a time, to their default (or removes them when there's none)
// until the settings pass. Returns { settings, reset: [keys] }, or null when the
// change itself is the problem.
function repairStoredSettings(merged, changedKeys, defaults, isValid) {
  if (isValid(merged)) return { settings: merged, reset: [] };
  const changed = new Set(changedKeys || []);
  let current = Object.assign({}, merged);
  const reset = [];
  for (let pass = 0; pass < 5; pass++) {
    let fixed = false;
    for (const key of Object.keys(current)) {
      if (changed.has(key)) continue;
      const hasDefault = Object.prototype.hasOwnProperty.call(defaults, key);
      if (hasDefault && JSON.stringify(defaults[key]) === JSON.stringify(current[key])) continue;
      const candidate = Object.assign({}, current);
      if (hasDefault) candidate[key] = defaults[key];
      else delete candidate[key];
      if (isValid(candidate)) return { settings: candidate, reset: reset.concat(key) };
    }
    // No single key fixes it: reset the first key that is invalid on its own
    // terms (its default validates where it doesn't) and try again.
    for (const key of Object.keys(defaults)) {
      if (changed.has(key) || !Object.prototype.hasOwnProperty.call(current, key)) continue;
      if (JSON.stringify(defaults[key]) === JSON.stringify(current[key])) continue;
      const withDefault = Object.assign({}, current, { [key]: defaults[key] });
      const allDefaults = Object.assign({}, defaults);
      const withValue = Object.assign({}, defaults, { [key]: current[key] });
      if (isValid(allDefaults) && !isValid(withValue)) {
        current = withDefault;
        reset.push(key);
        fixed = true;
        break;
      }
    }
    if (!fixed) return null;
    if (isValid(current)) return { settings: current, reset };
  }
  return null;
}

module.exports = { DEFAULT_SETTINGS, validateSettings, migrateCoreSettings, findLegacyUserDataDir, tabsToRestore, repairStoredSettings };
