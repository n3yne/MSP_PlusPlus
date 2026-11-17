"use strict";

// SLA Countdown plugin, main process: only its settings. The due times are read
// by the site plugins (their ticketSla adapter part, e.g. the Freshservice REST
// API); the tab badges and the side panel tab are renderer.js.

const LIMITS = {
  slaAmberMinutes: [1, 24 * 60],
  slaRedMinutes: [1, 24 * 60],
  slaRefreshMinutes: [1, 60],
};

module.exports = {
  defaultSettings: {
    slaTabBadges: true,
    slaNotify: true,
    slaAmberMinutes: 60,
    slaRedMinutes: 15,
    slaRefreshMinutes: 5,
  },

  validateSettings: function (s) {
    for (const k of ["slaTabBadges", "slaNotify"]) {
      if (s[k] !== undefined && typeof s[k] !== "boolean") return false;
    }
    for (const k of Object.keys(LIMITS)) {
      if (s[k] === undefined) continue;
      if (!Number.isInteger(s[k]) || s[k] < LIMITS[k][0] || s[k] > LIMITS[k][1]) return false;
    }
    return true;
  },

  init: function () {},
};
