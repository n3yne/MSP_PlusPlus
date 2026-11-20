"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const safeFile = require("../src/main/safe-file");
const { repairStoredSettings, DEFAULT_SETTINGS, validateSettings } = require("../src/main/utils");

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "msppp-safe-file-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("writeFileAtomic", () => {
  test("replaces the file and leaves no temp files", async () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "old");
    await safeFile.writeFileAtomic(file, "new");
    expect(fs.readFileSync(file, "utf-8")).toBe("new");
    expect(fs.readdirSync(dir)).toEqual(["a.json"]);
  });

  test("a failed write leaves the old file alone", async () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "old");
    const spy = jest.spyOn(fs.promises, "rename").mockRejectedValue(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
    try {
      await expect(safeFile.writeFileAtomic(file, "new")).rejects.toThrow("disk full");
    } finally {
      spy.mockRestore();
    }
    expect(fs.readFileSync(file, "utf-8")).toBe("old");
    expect(fs.readdirSync(dir)).toEqual(["a.json"]);
  });

  test("sync version", () => {
    const file = path.join(dir, "sub", "b.json");
    safeFile.writeFileAtomicSync(file, "x");
    expect(fs.readFileSync(file, "utf-8")).toBe("x");
  });
});

describe("readJsonFile", () => {
  const quiet = () => jest.spyOn(console, "error").mockImplementation(() => {});

  test("missing and ok", async () => {
    const file = path.join(dir, "settings.json");
    expect(await safeFile.readJsonFile(file)).toEqual({ value: null, status: "missing" });
    await safeFile.writeJsonWithBackup(file, { a: 1 });
    expect(await safeFile.readJsonFile(file)).toEqual({ value: { a: 1 }, status: "ok" });
    expect(JSON.parse(fs.readFileSync(file + ".bak", "utf-8"))).toEqual({ a: 1 });
  });

  test("a damaged file is kept aside and the backup used", async () => {
    const file = path.join(dir, "settings.json");
    await safeFile.writeJsonWithBackup(file, { theme: "light", bookmarks: [1] });
    fs.writeFileSync(file, '{"theme": "li'); // truncated
    const spy = quiet();
    const res = await safeFile.readJsonFile(file);
    const again = await safeFile.readJsonFile(file);
    spy.mockRestore();
    expect(res.status).toBe("recovered");
    expect(res.value).toEqual({ theme: "light", bookmarks: [1] });
    expect(fs.readFileSync(res.corruptCopy, "utf-8")).toBe('{"theme": "li');
    // Reading the same damaged file again doesn't make another copy.
    expect(again.corruptCopy).toBe(res.corruptCopy);
    expect(fs.readdirSync(dir).filter((f) => f.includes(".corrupt-"))).toHaveLength(1);
  });

  test("a damaged file with no backup is reported, not turned into {}", async () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "\u0000\u0000");
    const spy = quiet();
    const res = await safeFile.readJsonFile(file);
    spy.mockRestore();
    expect(res.status).toBe("corrupt");
    expect(res.value).toBeNull();
    expect(fs.existsSync(res.corruptCopy)).toBe(true);
  });
});

describe("repairStoredSettings", () => {
  const isValid = (s) => validateSettings(s) && (s.retention === undefined || s.retention > 0);

  test("valid settings pass untouched", () => {
    const s = { ...DEFAULT_SETTINGS, theme: "light" };
    expect(repairStoredSettings(s, ["theme"], DEFAULT_SETTINGS, isValid)).toEqual({ settings: s, reset: [] });
  });

  test("a bad stored value is reset so the change can be saved", () => {
    const s = { ...DEFAULT_SETTINGS, theme: "purple", panelCollapsed: true };
    const res = repairStoredSettings(s, ["panelCollapsed"], DEFAULT_SETTINGS, isValid);
    expect(res.reset).toEqual(["theme"]);
    expect(res.settings).toEqual({ ...DEFAULT_SETTINGS, panelCollapsed: true });
  });

  test("a stored key with no default is removed when it's the problem", () => {
    const s = { ...DEFAULT_SETTINGS, retention: -1 };
    const res = repairStoredSettings(s, ["panelCollapsed"], DEFAULT_SETTINGS, isValid);
    expect(res.reset).toEqual(["retention"]);
    expect("retention" in res.settings).toBe(false);
  });

  test("an invalid change itself is still refused", () => {
    const s = { ...DEFAULT_SETTINGS, theme: "purple" };
    expect(repairStoredSettings(s, ["theme"], DEFAULT_SETTINGS, isValid)).toBeNull();
  });

  test("keys it's told to keep (API keys) are never reset", () => {
    const s = { ...DEFAULT_SETTINGS, retention: -1 };
    expect(repairStoredSettings(s, ["retention"], DEFAULT_SETTINGS, isValid)).toBeNull();
  });
});
