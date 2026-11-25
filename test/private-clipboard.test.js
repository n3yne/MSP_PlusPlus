"use strict";

const { createPrivateClipboard } = require("../src/main/private-clipboard");

function plain() {
  const c = { text: "", writeText(s) { c.text = s; } };
  return c;
}

describe("private clipboard (api.clipboard)", () => {
  test("uses the native addon on Windows and reports a private copy", () => {
    const native = { writeTextPrivate: jest.fn(() => true) };
    const clipboard = plain();
    const pc = createPrivateClipboard({ platform: "win32", loader: () => ({ available: true, native }), clipboard });
    expect(pc.isSupported()).toBe(true);
    expect(pc.writePrivate("s3cret pass")).toBe(true);
    expect(native.writeTextPrivate).toHaveBeenCalledWith("s3cret pass");
    expect(clipboard.text).toBe("");
  });

  test("copies normally when Windows refuses", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const native = { writeTextPrivate: () => { throw new Error("The clipboard is in use by another app"); } };
    const clipboard = plain();
    const pc = createPrivateClipboard({ platform: "win32", loader: () => ({ available: true, native }), clipboard });
    expect(pc.writePrivate("abc")).toBe(false);
    expect(clipboard.text).toBe("abc");
    warn.mockRestore();
  });

  test("copies normally off Windows or without the addon", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const mac = plain();
    const loader = jest.fn();
    const onMac = createPrivateClipboard({ platform: "darwin", loader, clipboard: mac });
    expect(onMac.isSupported()).toBe(false);
    expect(onMac.writePrivate("x")).toBe(false);
    expect(mac.text).toBe("x");
    expect(loader).not.toHaveBeenCalled();
    const win = plain();
    const missing = createPrivateClipboard({ platform: "win32", loader: () => { throw new Error("not built"); }, clipboard: win });
    expect(missing.writePrivate("y")).toBe(false);
    expect(win.text).toBe("y");
    warn.mockRestore();
  });

  test("an empty string just clears normally", () => {
    const native = { writeTextPrivate: jest.fn(() => true) };
    const clipboard = plain();
    clipboard.text = "old";
    const pc = createPrivateClipboard({ platform: "win32", loader: () => ({ available: true, native }), clipboard });
    expect(pc.writePrivate("")).toBe(false);
    expect(native.writeTextPrivate).not.toHaveBeenCalled();
    expect(clipboard.text).toBe("");
  });
});
