"use strict";

// Password Vault auto-fill: site matching, the fill script (against a small
// fake page) and main.js's checks before it fills.

const fs = require("fs");
const os = require("os");
const path = require("path");

const F = require("../plugins/password-vault/vault-fill");
const V = require("../plugins/password-vault/vault-session");

const FAST_KDF = { m: 19456, t: 2, p: 1 };
const PW = "correct horse battery";

describe("password-vault auto-fill matching", () => {
  test("this site only by default: same host, www. ignored, https page only", () => {
    expect(F.siteMatches("https://service.rakedigital.com/login", "https://service.rakedigital.com/a/b?c", "host")).toBe(true);
    expect(F.siteMatches("service.rakedigital.com", "https://service.rakedigital.com/", "host")).toBe(true);
    expect(F.siteMatches("https://www.example.com", "https://example.com/", "host")).toBe(true);
    expect(F.siteMatches("https://example.com", "https://www.example.com/", "host")).toBe(true);
    expect(F.siteMatches("https://Example.COM.", "https://example.com/", "host")).toBe(true);
    expect(F.siteMatches("https://rakedigital.com", "https://service.rakedigital.com/", "host")).toBe(false);
    expect(F.siteMatches("https://service.rakedigital.com", "http://service.rakedigital.com/", "host")).toBe(false);
    expect(F.siteMatches("https://example.com", "https://example.com.evil.net/", "host")).toBe(false);
    expect(F.siteMatches("https://example.com", "https://notexample.com/", "host")).toBe(false);
  });

  test("subdomains too, only when the entry says so", () => {
    expect(F.siteMatches("https://rakedigital.com", "https://service.rakedigital.com/", "domain")).toBe(true);
    expect(F.siteMatches("https://rakedigital.com", "https://a.b.rakedigital.com/", "domain")).toBe(true);
    expect(F.siteMatches("https://rakedigital.com", "https://evilrakedigital.com/", "domain")).toBe(false);
    expect(F.siteMatches("https://a.freshservice.com", "https://b.freshservice.com/", "domain")).toBe(false);
    // A bare word never matches everyone's subdomains.
    expect(F.siteMatches("https://localhost", "https://x.localhost/", "domain")).toBe(false);
  });

  test("ports must match; junk never matches", () => {
    expect(F.siteMatches("https://example.com:8443", "https://example.com:8443/", "host")).toBe(true);
    expect(F.siteMatches("https://example.com:8443", "https://example.com/", "host")).toBe(false);
    expect(F.siteMatches("", "https://example.com/", "host")).toBe(false);
    expect(F.siteMatches("javascript:alert(1)", "https://example.com/", "host")).toBe(false);
    expect(F.siteMatches("https://example.com", "about:blank", "host")).toBe(false);
    expect(F.siteMatches("https://example.com", null, "host")).toBe(false);
  });

  test("the shortcut's order: last filled first, then by name", () => {
    const list = [{ id: "a", name: "beta" }, { id: "b", name: "Alpha" }, { id: "c", name: "gamma" }];
    expect(F.orderMatches(list, new Map()).map((e) => e.id)).toEqual(["b", "a", "c"]);
    expect(F.orderMatches(list, new Map([["c", 5], ["a", 2]])).map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

// ---------- A small fake page for the fill script ----------

function fakePage(origin, specs) {
  const inputs = [];
  class Input {
    constructor(attrs, idx) {
      this.attrs = attrs;
      this.idx = idx;
      this._value = "";
      this.events = [];
      this.disabled = !!attrs.disabled;
      this.readOnly = !!attrs.readonly;
      this.form = attrs.form || null;
      this.name = attrs.name || "";
      this.id = attrs.id || "";
      this.hidden = !!attrs.hidden;
    }
    get type() {
      const t = (this.attrs.type || "text").toLowerCase();
      return ["text", "email", "password", "tel", "url", "search", "checkbox", "hidden", "submit"].includes(t) ? t : "text";
    }
    getAttribute(n) { return this.attrs[n] === undefined ? null : String(this.attrs[n]); }
    getBoundingClientRect() { return this.hidden ? { width: 0, height: 0 } : { width: 200, height: 24 }; }
    focus() { page.focused = this; }
    dispatchEvent(e) { this.events.push(e.type); }
    compareDocumentPosition(other) { return other.idx > this.idx ? 4 : 2; }
  }
  Object.defineProperty(Input.prototype, "value", {
    get() { return this._value; },
    set(v) { this._value = v; },
  });
  specs.forEach((s, i) => inputs.push(new Input(s, i)));
  const page = {
    inputs,
    focused: null,
    globals: {
      location: { origin },
      document: { querySelectorAll: () => inputs },
      getComputedStyle: (el) => ({ visibility: "visible", display: el.attrs.type === "hidden" ? "none" : "block", opacity: "1" }),
      HTMLInputElement: Input,
      Event: class { constructor(type) { this.type = type; } },
      Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
    },
  };
  return page;
}

function runFill(page, origin, user, pass) {
  const script = F.buildFillScript(origin, user, pass);
  const names = Object.keys(page.globals);
  return new Function(...names, "return " + script)(...names.map((n) => page.globals[n]));
}

describe("password-vault fill script", () => {
  const O = "https://login.example.com";

  test("fills the username and password boxes and tells the page", () => {
    const page = fakePage(O, [
      { type: "search", name: "q" },
      { type: "email", name: "loginfmt" },
      { type: "password", name: "passwd" },
      { type: "checkbox", name: "remember" },
    ]);
    expect(runFill(page, O, "me@example.com", "s3cret")).toEqual({ filled: "both" });
    expect(page.inputs[1].value).toBe("me@example.com");
    expect(page.inputs[2].value).toBe("s3cret");
    expect(page.inputs[0].value).toBe("");
    expect(page.inputs[2].events).toEqual(["input", "change"]);
    expect(page.focused).toBe(page.inputs[2]);
  });

  test("an email-first page (Microsoft): just the username", () => {
    const page = fakePage(O, [{ type: "email", name: "loginfmt" }]);
    expect(runFill(page, O, "me@example.com", "s3cret")).toEqual({ filled: "username" });
    expect(page.inputs[0].value).toBe("me@example.com");
  });

  test("the password page of a two-step sign-in", () => {
    const page = fakePage(O, [{ type: "password", name: "passwd" }]);
    expect(runFill(page, O, "me@example.com", "s3cret")).toEqual({ filled: "password" });
  });

  test("skips hidden, disabled and read-only boxes", () => {
    const page = fakePage(O, [
      { type: "text", name: "username", hidden: true },
      { type: "text", name: "user2", disabled: true },
      { type: "text", name: "login" },
      { type: "password", name: "trap", hidden: true },
      { type: "password", name: "pw" },
    ]);
    expect(runFill(page, O, "me", "pw")).toEqual({ filled: "both" });
    expect(page.inputs[2].value).toBe("me");
    expect(page.inputs[4].value).toBe("pw");
    expect(page.inputs[3].value).toBe("");
  });

  test("prefers the current-password box on a change-password page", () => {
    const page = fakePage(O, [
      { type: "password", name: "new", autocomplete: "new-password" },
      { type: "password", name: "old", autocomplete: "current-password" },
    ]);
    runFill(page, O, "", "old-one");
    expect(page.inputs[1].value).toBe("old-one");
    expect(page.inputs[0].value).toBe("");
  });

  test("does nothing if the page moved to another site", () => {
    const page = fakePage("https://evil.example.net", [{ type: "text", name: "user" }, { type: "password" }]);
    expect(runFill(page, O, "me", "pw")).toEqual({ filled: "none", reason: "moved" });
    expect(page.inputs[1].value).toBe("");
  });

  test("no sign-in boxes: reports it", () => {
    const page = fakePage(O, [{ type: "search", name: "q" }, { type: "text", name: "a" }, { type: "text", name: "b" }]);
    expect(runFill(page, O, "me", "pw")).toEqual({ filled: "none", reason: "no-fields" });
  });

  test("quotes and script in the values stay values", () => {
    const evil = "\"); window.pwned = 1; (\"</script> ";
    const page = fakePage(O, [{ type: "text", name: "user" }, { type: "password" }]);
    runFill(page, O, evil, evil);
    expect(page.inputs[0].value).toBe(evil);
    expect(page.inputs[1].value).toBe(evil);
  });
});

describe("password-vault entries keep their match mode", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "msp-vault-fill-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("host by default, domain when asked, anything else is host", async () => {
    const s = new V.VaultSession({ filePath: path.join(dir, "vault.json"), kdf: FAST_KDF });
    await s.init();
    await s.create(PW);
    const a = await s.saveEntry({ name: "A", url: "https://a.example.com" });
    const b = await s.saveEntry({ name: "B", url: "https://example.com", match: "domain" });
    const c = await s.saveEntry({ name: "C", url: "https://c.example.com", match: "everything" });
    const byId = Object.fromEntries(s.listEntries().map((e) => [e.id, e.match]));
    expect(byId[a.id]).toBe("host");
    expect(byId[b.id]).toBe("domain");
    expect(byId[c.id]).toBe("host");
  });
});

// ---------- main.js: what it checks before filling ----------

describe("password-vault main.js fill", () => {
  let dir;
  let tabs;
  let handlers;
  let messages;
  let menu;
  let notes;

  function fakeTab(id, url, answer) {
    const tab = {
      id,
      url,
      type: "webview",
      calls: [],
      isDestroyed: () => false,
      getType: () => tab.type,
      getURL: () => tab.url,
      async executeJavaScriptInIsolatedWorld(world, scripts) {
        tab.calls.push({ world, code: scripts[0].code });
        return typeof answer === "function" ? answer() : answer;
      },
    };
    tabs.set(id, tab);
    return tab;
  }

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "msp-vault-main-"));
    tabs = new Map();
    handlers = {};
    messages = {};
    menu = [];
    notes = [];
    // A vault made with quick Argon2 settings, so unlocking is fast.
    const s = new V.VaultSession({ filePath: path.join(dir, "vault.json"), kdf: FAST_KDF });
    await s.init();
    await s.create(PW);
    await s.saveEntry({ name: "Rake", username: "sean", password: "pw-1", url: "https://service.rakedigital.com" });
    await s.saveEntry({ name: "Rake (admin)", username: "admin", password: "pw-2", url: "https://rakedigital.com", match: "domain" });
    await s.saveEntry({ name: "Other", username: "x", password: "pw-3", url: "https://other.example.com" });
    s.lock();

    jest.resetModules();
    jest.doMock("electron", () => ({
      app: { on() {}, getPath: () => dir },
      clipboard: { writeText() {}, readText: () => "", clear() {} },
      powerMonitor: { on() {} },
      dialog: {},
      BrowserWindow: { getFocusedWindow: () => null },
      webContents: { fromId: (id) => tabs.get(id) || null },
      Notification: class {
        static isSupported() { return true; }
        constructor(o) { this.o = o; }
        show() { notes.push(this.o.body); }
      },
    }));
    const main = require("../plugins/password-vault/main");
    main.init({
      getDataPath: () => dir,
      handle: (a, fn) => { handlers[a] = fn; },
      onMessage: (a, fn) => { messages[a] = fn; },
      addMenuItem: (m) => menu.push(m),
      log() {},
    });
  });
  afterEach(() => {
    jest.dontMock("electron");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function unlock() {
    const res = await handlers.unlock({ password: PW });
    expect(res.state).toBe("unlocked");
  }
  async function idOf(name) {
    const list = (await handlers.list({})).entries;
    return list.find((e) => e.name === name).id;
  }

  test("nothing fills while locked", async () => {
    fakeTab(7, "https://service.rakedigital.com/login", { filled: "both" });
    const res = await handlers.fill({ id: "whatever", webContentsId: 7 });
    expect(res).toEqual({ ok: false, error: "locked" });
    expect(tabs.get(7).calls).toHaveLength(0);
  });

  test("matching lists this site's logins, subdomain entries included", async () => {
    await unlock();
    const res = await handlers.matching({ url: "https://service.rakedigital.com/a" });
    expect(res.matches.map((m) => m.name)).toEqual(["Rake", "Rake (admin)"]);
    expect(res.matches[0]).toEqual({ id: expect.any(String), name: "Rake", username: "sean" });
    expect(res.matches[0].password).toBeUndefined();
    expect((await handlers.matching({ url: "http://service.rakedigital.com/" })).matches).toEqual([]);
  });

  test("fills a matching https page in an isolated world", async () => {
    await unlock();
    const tab = fakeTab(7, "https://service.rakedigital.com/login", { filled: "both" });
    const res = await handlers.fill({ id: await idOf("Rake"), webContentsId: 7 });
    expect(res).toEqual({ ok: true, filled: "both", name: "Rake" });
    expect(tab.calls).toHaveLength(1);
    expect(tab.calls[0].world).not.toBe(0);
    expect(tab.calls[0].code).toContain(JSON.stringify("https://service.rakedigital.com"));
    expect(tab.calls[0].code).toContain("\"pw-1\"");
  });

  test("refuses another site, plain http and MSP++'s own pages", async () => {
    await unlock();
    const id = await idOf("Rake");
    const wrong = fakeTab(1, "https://other.example.com/", { filled: "both" });
    expect(await handlers.fill({ id, webContentsId: 1 })).toEqual({ ok: false, error: "fill-wrong-site" });
    const http = fakeTab(2, "http://service.rakedigital.com/", { filled: "both" });
    expect(await handlers.fill({ id, webContentsId: 2 })).toEqual({ ok: false, error: "fill-not-https" });
    const own = fakeTab(3, "https://service.rakedigital.com/", { filled: "both" });
    own.type = "window";
    expect(await handlers.fill({ id, webContentsId: 3 })).toEqual({ ok: false, error: "fill-no-tab" });
    expect(await handlers.fill({ id, webContentsId: 99 })).toEqual({ ok: false, error: "fill-no-tab" });
    expect(wrong.calls.length + http.calls.length + own.calls.length).toBe(0);
  });

  test("a page that moved or has no sign-in box is reported", async () => {
    await unlock();
    const id = await idOf("Rake");
    fakeTab(1, "https://service.rakedigital.com/", { filled: "none", reason: "moved" });
    expect((await handlers.fill({ id, webContentsId: 1 })).error).toBe("fill-wrong-site");
    fakeTab(2, "https://service.rakedigital.com/", { filled: "none", reason: "no-fields" });
    expect((await handlers.fill({ id, webContentsId: 2 })).error).toBe("fill-no-fields");
  });

  test("Ctrl+Shift+F fills the active tab, and again moves to the next login", async () => {
    await unlock();
    const tab = fakeTab(5, "https://service.rakedigital.com/login", { filled: "both" });
    messages["active-tab"]({ webContentsId: 5 });
    const item = menu.find((m) => m.accelerator === "CmdOrCtrl+Shift+F");
    expect(item).toBeTruthy();
    const pressed = async () => { item.click(); await new Promise((r) => setTimeout(r, 20)); };
    await pressed();
    await pressed();
    await pressed();
    expect(tab.calls.map((c) => /"pw-\d"/.exec(c.code)[0])).toEqual(["\"pw-1\"", "\"pw-2\"", "\"pw-1\""]);
    expect(notes.some((n) => n.includes("next login"))).toBe(true);
  });

  test("Ctrl+Shift+F explains what's wrong instead of filling", async () => {
    const item = menu.find((m) => m.accelerator === "CmdOrCtrl+Shift+F");
    const tab = fakeTab(5, "https://nobody.example.org/", { filled: "both" });
    messages["active-tab"]({ webContentsId: 5 });
    item.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.pop()).toContain("locked");
    await unlock();
    item.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(notes.pop()).toContain("No saved login for nobody.example.org");
    expect(tab.calls).toHaveLength(0);
  });
});
