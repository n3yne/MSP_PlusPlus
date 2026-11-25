// Plugin release stages: how finished a plugin version is, so people know what
// they're getting into, and so they can choose the lowest stage they'll take
// updates at (Settings > General > Plugin Updates, with a per-plugin override).
//
// A plugin names its stage in its manifest ("stage": "beta"). No stage, or one
// this app doesn't know, counts as stable, so every plugin published before
// stages existed keeps working as it did. The build script copies the stage
// into the directory's index.json; apps before 0.8.10 ignore it.
//
// Shared by the settings window and main window (script tag), the main process,
// the directory build script and tests (require).
(function (root) {
  "use strict";

  // Least finished first. rank: higher is more finished.
  const STAGES = [
    {
      id: "pre-alpha", label: "Pre-alpha", rank: 0, minLabel: "Everything (including pre-alpha)",
      description: "Pre-alpha: an early experiment. Expect missing features and bugs, and it may change a lot or be dropped.",
    },
    {
      id: "alpha", label: "Alpha", rank: 1, minLabel: "Alpha or better",
      description: "Alpha: the main features are there but barely tested. Expect bugs.",
    },
    {
      id: "beta", label: "Beta", rank: 2, minLabel: "Beta or better",
      description: "Beta: feature-complete and being tested. Some bugs are likely.",
    },
    {
      id: "rc", label: "RC", rank: 3, minLabel: "RC or better",
      description: "Release candidate: expected to become the stable version unless a problem turns up.",
    },
    {
      id: "stable", label: "Stable", rank: 4, minLabel: "Stable only",
      description: "Stable: tested and ready for everyday use.",
    },
  ];
  const DEFAULT_STAGE = "stable";
  // Default lowest stage to update to.
  const DEFAULT_UPDATE_STAGE = "stable";
  const byId = {};
  STAGES.forEach(function (s) { byId[s.id] = s; });
  // Spellings people might write in a manifest.
  const ALIASES = { prealpha: "pre-alpha", "pre alpha": "pre-alpha", "release candidate": "rc", "release-candidate": "rc" };

  // A known stage id for value, or "" when it isn't one.
  function parseStage(value) {
    if (typeof value !== "string") return "";
    const v = value.trim().toLowerCase();
    if (byId[v]) return v;
    return ALIASES[v] || "";
  }

  // The stage of a manifest or index entry value: unknown or missing is stable.
  function normalizeStage(value) {
    return parseStage(value) || DEFAULT_STAGE;
  }

  function isStage(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(byId, value);
  }

  function info(stage) {
    return Object.assign({}, byId[normalizeStage(stage)]);
  }

  function rank(stage) {
    return byId[normalizeStage(stage)].rank;
  }

  // True when a version at `stage` is at least `minStage` (both normalized).
  function meetsStage(stage, minStage) {
    return rank(stage) >= rank(minStage);
  }

  function isStable(stage) {
    return normalizeStage(stage) === "stable";
  }

  // The lowest stage to update plugin `id` to, from settings:
  //   pluginUpdateStage           global lowest stage (default "stable")
  //   pluginUpdateStageOverrides  { "<id>": "<stage>" } per plugin; missing = global
  function updateStageFor(settings, id) {
    const s = settings && typeof settings === "object" ? settings : {};
    const overrides = s.pluginUpdateStageOverrides && typeof s.pluginUpdateStageOverrides === "object"
      ? s.pluginUpdateStageOverrides : {};
    if (typeof id === "string" && Object.prototype.hasOwnProperty.call(overrides, id) && isStage(overrides[id])) {
      return overrides[id];
    }
    return isStage(s.pluginUpdateStage) ? s.pluginUpdateStage : DEFAULT_UPDATE_STAGE;
  }

  const MAX_OVERRIDES = 200;
  const OVERRIDE_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

  // Settings validation for pluginUpdateStageOverrides (undefined is fine).
  function validOverrides(value) {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (keys.length > MAX_OVERRIDES) return false;
    return keys.every(function (k) { return OVERRIDE_ID.test(k) && isStage(value[k]); });
  }

  const api = {
    STAGES: STAGES.map(function (s) { return Object.assign({}, s); }),
    DEFAULT_STAGE,
    DEFAULT_UPDATE_STAGE,
    parseStage,
    normalizeStage,
    isStage,
    info,
    rank,
    meetsStage,
    isStable,
    updateStageFor,
    validOverrides,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PluginStages = api;
})(typeof window !== "undefined" ? window : globalThis);
