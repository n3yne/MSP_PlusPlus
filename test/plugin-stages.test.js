"use strict";

const PluginStages = require("../src/shared/plugin-stages");

describe("plugin-stages", () => {
  test("lists the five stages from least to most finished", () => {
    expect(PluginStages.STAGES.map((s) => s.id)).toEqual(["pre-alpha", "alpha", "beta", "rc", "stable"]);
    expect(PluginStages.STAGES.map((s) => s.rank)).toEqual([0, 1, 2, 3, 4]);
  });

  test("normalizeStage: missing or unknown is stable; tolerant spellings", () => {
    expect(PluginStages.normalizeStage(undefined)).toBe("stable");
    expect(PluginStages.normalizeStage("nightly")).toBe("stable");
    expect(PluginStages.normalizeStage(" Beta ")).toBe("beta");
    expect(PluginStages.normalizeStage("RC")).toBe("rc");
    expect(PluginStages.normalizeStage("Release Candidate")).toBe("rc");
    expect(PluginStages.normalizeStage("prealpha")).toBe("pre-alpha");
  });

  test("meetsStage compares by how finished", () => {
    expect(PluginStages.meetsStage("beta", "beta")).toBe(true);
    expect(PluginStages.meetsStage("rc", "beta")).toBe(true);
    expect(PluginStages.meetsStage("alpha", "beta")).toBe(false);
    expect(PluginStages.meetsStage("stable", "stable")).toBe(true);
    expect(PluginStages.meetsStage(undefined, "stable")).toBe(true);
    expect(PluginStages.meetsStage("pre-alpha", "pre-alpha")).toBe(true);
  });

  test("updateStageFor: per-plugin override, then global, then stable", () => {
    expect(PluginStages.updateStageFor({}, "x")).toBe("stable");
    expect(PluginStages.updateStageFor({ pluginUpdateStage: "beta" }, "x")).toBe("beta");
    expect(PluginStages.updateStageFor({ pluginUpdateStage: "beta", pluginUpdateStageOverrides: { x: "alpha" } }, "x")).toBe("alpha");
    expect(PluginStages.updateStageFor({ pluginUpdateStage: "beta", pluginUpdateStageOverrides: { x: "alpha" } }, "y")).toBe("beta");
    expect(PluginStages.updateStageFor({ pluginUpdateStage: "bogus", pluginUpdateStageOverrides: { x: "bogus" } }, "x")).toBe("stable");
    expect(PluginStages.updateStageFor(null, "x")).toBe("stable");
  });

  test("validOverrides", () => {
    expect(PluginStages.validOverrides(undefined)).toBe(true);
    expect(PluginStages.validOverrides({})).toBe(true);
    expect(PluginStages.validOverrides({ "time-tracker": "beta" })).toBe(true);
    expect(PluginStages.validOverrides({ "time-tracker": "Beta" })).toBe(false);
    expect(PluginStages.validOverrides({ "Bad Id": "beta" })).toBe(false);
    expect(PluginStages.validOverrides([])).toBe(false);
    expect(PluginStages.validOverrides("beta")).toBe(false);
  });

  test("info gives a label and a description for every stage", () => {
    for (const s of PluginStages.STAGES) {
      const info = PluginStages.info(s.id);
      expect(info.label).toBeTruthy();
      expect(info.description).toMatch(/:/);
      expect(info.minLabel).toBeTruthy();
    }
  });
});
