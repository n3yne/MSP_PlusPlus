"use strict";

const web = require("../plugins/ai-features/copilot-web");
const { makePage, el } = require("./page-dom");

// ---------- A stand-in Copilot page ----------

function copilotPage(options) {
  const opts = options || {};
  const input = opts.noInput ? null : el("textarea", { attrs: { id: "userInput" } });
  const thread = el("div.thread");
  const send = el("button", { attrs: { "aria-label": "Send" } });
  const body = [thread];
  if (input) body.push(input);
  body.push(send);
  const page = makePage({ url: "https://copilot.cloud.microsoft/chat", body });
  page.selection.toString = () => "";
  page.input = input;
  page.thread = thread;
  page.sendButton = send;
  page.addReply = (text) => {
    const reply = el("div", { attrs: { "data-content": "ai-message" }, text });
    thread.appendChild(reply);
    return reply;
  };
  return page;
}

describe("copilot-web sites", () => {
  test("defaults to Copilot with a work account", () => {
    const site = web.siteFor({});
    expect(site.key).toBe("copilot-work");
    expect(site.url).toBe("https://copilot.cloud.microsoft/chat");
    expect(site.maxPromptChars).toBe(16000);
  });

  test("a custom site needs an https address", () => {
    expect(web.siteFor({ aiWebSite: "custom", aiWebUrl: "https://chat.example.com/x" }).url).toBe("https://chat.example.com/x");
    expect(web.siteFor({ aiWebSite: "custom", aiWebUrl: "http://chat.example.com/" }).url).toBe("");
    expect(web.siteFor({ aiWebSite: "custom", aiWebUrl: "javascript:alert(1)" }).url).toBe("");
  });

  test("an unknown site falls back to the default", () => {
    expect(web.siteFor({ aiWebSite: "nope" }).key).toBe("copilot-work");
  });

  test("normalizeSiteUrl", () => {
    expect(web.normalizeSiteUrl("  https://copilot.microsoft.com ")).toBe("https://copilot.microsoft.com/");
    expect(web.normalizeSiteUrl("ftp://x")).toBeNull();
    expect(web.normalizeSiteUrl("")).toBeNull();
  });
});

describe("copilot-web page script", () => {
  test("probe finds the message box, replies and the Stop button", () => {
    const page = copilotPage();
    expect(page.run(web.pageScript("probe"))).toEqual({ hasInput: true, inputLength: 0, replyCount: 0, lastReply: "", busy: false });
    page.addReply("Hello! How can I help?");
    page.body.appendChild(el("button", { attrs: { "aria-label": "Stop responding" } }));
    const p = page.run(web.pageScript("probe"));
    expect(p.replyCount).toBe(1);
    expect(p.lastReply).toBe("Hello! How can I help?");
    expect(p.busy).toBe(true);
  });

  test("probe ignores hidden elements", () => {
    const page = copilotPage();
    page.input.style.display = "none";
    page.addReply("hidden").style.display = "none";
    const p = page.run(web.pageScript("probe"));
    expect(p.hasInput).toBe(false);
    expect(p.replyCount).toBe(0);
  });

  test("focus selects what's in the box so typing replaces it", () => {
    const page = copilotPage();
    page.input.value = "old draft";
    expect(page.run(web.pageScript("focus"))).toBe(true);
    expect(page.document.activeElement).toBe(page.input);
    expect([page.input.selectionStart, page.input.selectionEnd]).toEqual([0, 9]);
  });

  test("focus selects all in a contenteditable box", () => {
    const box = el("div", { attrs: { contenteditable: "true", role: "textbox" } });
    const page = makePage({ body: [box] });
    expect(page.run(web.pageScript("focus"))).toBe(true);
    expect(page.document.commands).toEqual([["selectAll", undefined]]);
  });

  test("focus fails without a message box", () => {
    const page = copilotPage({ noInput: true });
    expect(page.run(web.pageScript("focus"))).toBe(false);
  });

  test("send clicks the Send button, or one labelled send", () => {
    const page = copilotPage();
    let clicks = 0;
    page.sendButton.click = () => { clicks++; };
    expect(page.run(web.pageScript("send"))).toBe(true);
    expect(clicks).toBe(1);

    const other = el("button", { attrs: { "aria-label": "Submit message" } });
    let otherClicks = 0;
    other.click = () => { otherClicks++; };
    const page2 = makePage({ body: [el("textarea"), other] });
    expect(page2.run(web.pageScript("send"))).toBe(true);
    expect(otherClicks).toBe(1);
  });

  test("send refuses a disabled button", () => {
    const page = makePage({ body: [el("button", { attrs: { "aria-label": "Send" }, disabled: true })] });
    expect(page.run(web.pageScript("send"))).toBe(false);
  });

  test("selection returns the selected text", () => {
    const page = copilotPage();
    page.selection.toString = () => "  picked text ";
    expect(page.run(web.pageScript("selection"))).toBe("picked text");
  });
});

describe("copilot-web replyFinished", () => {
  const base = { replyCount: 0, lastReply: "" };

  test("needs a new, stable reply with no Stop button", () => {
    const p = { replyCount: 1, lastReply: "Answer", busy: false };
    expect(web.replyFinished(base, p, 1000, 1000 + web.STABLE_MS)).toBe(true);
    expect(web.replyFinished(base, p, 1000, 1500)).toBe(false);
    expect(web.replyFinished(base, Object.assign({}, p, { busy: true }), 0, 1e9)).toBe(false);
    expect(web.replyFinished(base, { replyCount: 0, lastReply: "", busy: false }, 0, 1e9)).toBe(false);
  });

  test("a greeting already on the page doesn't count", () => {
    const greeting = { replyCount: 1, lastReply: "Hi there" };
    expect(web.replyFinished(greeting, { replyCount: 1, lastReply: "Hi there", busy: false }, 0, 1e9)).toBe(false);
    expect(web.replyFinished(greeting, { replyCount: 2, lastReply: "Answer", busy: false }, 0, 1e9)).toBe(true);
  });
});

describe("copilot-web pickReply", () => {
  const base = { replyCount: 0, lastReply: "" };
  const probe = { replyCount: 1, lastReply: "From the page" };

  test("selection first, then the page, then a changed clipboard", () => {
    expect(web.pickReply({ selection: "Selected", probe, base, clipboard: "c", clipboardAtStart: "", prompt: "p" })).toBe("Selected");
    expect(web.pickReply({ selection: "", probe, base, clipboard: "c", clipboardAtStart: "", prompt: "p" })).toBe("From the page");
    expect(web.pickReply({ selection: "", probe: base, base, clipboard: "Copied reply", clipboardAtStart: "old", prompt: "p" })).toBe("Copied reply");
  });

  test("never hands back the prompt or an unchanged clipboard", () => {
    expect(web.pickReply({ selection: "the prompt", probe: base, base, clipboard: "the prompt", clipboardAtStart: "", prompt: "the prompt" })).toBe("");
    expect(web.pickReply({ selection: "", probe: base, base, clipboard: "same", clipboardAtStart: "same", prompt: "p" })).toBe("");
  });
});

// ---------- The window and requests, with a fake Electron ----------

function fakeElectron(page) {
  const state = { clipboard: "", windows: [], loads: [], cleared: 0, inserted: [] };
  const listeners = {};

  function webContents(extra) {
    const handlers = {};
    return Object.assign({
      on(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
      once(name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
      emit(name, ...args) { (handlers[name] || []).forEach((fn) => fn(...args)); },
      setWindowOpenHandler(fn) { this.openHandler = fn; },
      setUserAgent(ua) { this.ua = ua; },
      isDestroyed: () => false,
      isLoading: () => false,
      bar: null,
      executeJavaScript(script) {
        if (script.startsWith("window.setBar")) {
          this.bar = JSON.parse(script.slice("window.setBar && window.setBar(".length, -1));
          return Promise.resolve();
        }
        return Promise.resolve(page.run(script));
      },
    }, extra);
  }

  class BrowserWindow {
    constructor(opts) {
      this.opts = opts;
      this.destroyed = false;
      this.visible = false;
      this.handlers = {};
      this.webContents = webContents({ loadFile: () => Promise.resolve() });
      this.contentView = { addChildView: (v) => { this.child = v; } };
      state.windows.push(this);
    }
    on(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; (this.handlers.closed || []).forEach((fn) => fn()); }
    close() { this.destroy(); }
    loadFile() { return Promise.resolve(); }
    getContentSize() { return [560, 820]; }
    isMinimized() { return false; }
    restore() {}
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    getParentWindow() { return null; }
    static getAllWindows() { return state.windows.filter((w) => !w.destroyed); }
    static getFocusedWindow() { return null; }
  }

  class WebContentsView {
    constructor(opts) {
      this.opts = opts;
      this.webContents = webContents({
        loadURL(url) { state.loads.push(url); return Promise.resolve(); },
        insertText(text) {
          state.inserted.push(text);
          const active = page.document.activeElement;
          if (active && active.value !== undefined) active.value = text;
        },
      });
    }
    setBounds(b) { this.bounds = b; }
  }

  const ses = {
    setUserAgent() {},
    setPermissionRequestHandler(fn) { ses.permissionHandler = fn; },
    clearStorageData() { state.cleared++; return Promise.resolve(); },
  };

  return {
    state,
    electron: {
      BrowserWindow,
      WebContentsView,
      session: { fromPartition: (name) => { state.partition = name; return ses; } },
      clipboard: { readText: () => state.clipboard, writeText: (t) => { state.clipboard = t; } },
      app: { on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); } },
    },
    ses,
    bar: () => state.windows[0] && state.windows[0].webContents.bar,
    win: () => state.windows[0],
  };
}

// A fake clock: sleep() moves time on and yields, so polling loops run instantly.
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms) => { t += ms; return new Promise((r) => setImmediate(r)); },
  };
}

async function until(fn) {
  for (let i = 0; i < 500; i++) {
    if (fn()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error("condition never became true");
}

function setup(pageOptions) {
  const page = copilotPage(pageOptions);
  const fake = fakeElectron(page);
  const c = clock();
  const api = { log: jest.fn() };
  const client = web.createCopilotWeb(api, { electron: fake.electron, now: c.now, sleep: c.sleep });
  return { page, fake, client, api };
}

describe("copilot-web one-click requests", () => {
  test("types the prompt, waits for the user, and returns the reply on Use this reply", async () => {
    const { page, fake, client } = setup();
    const result = client.chat("Summarize this ticket", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    expect(fake.state.loads).toEqual(["https://copilot.cloud.microsoft/chat"]);
    expect(page.input.value).toBe("Summarize this ticket");
    expect(fake.win().visible).toBe(true);
    expect(fake.state.partition).toBe(web.PARTITION);

    page.addReply("Here is the summary.");
    await client._onBarAction("use");
    await expect(result).resolves.toBe("Here is the summary.");
    expect(fake.win().visible).toBe(false);
  });

  test("Use this reply without a reply keeps waiting", async () => {
    const { page, fake, client } = setup();
    const result = client.chat("Prompt", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    await client._onBarAction("use");
    expect(fake.bar().text).toMatch(/Couldn't find a reply yet/);
    expect(client._pending()).not.toBeNull();
    page.selection.toString = () => "Selected answer";
    await client._onBarAction("use");
    await expect(result).resolves.toBe("Selected answer");
  });

  test("falls back to the clipboard when there's no message box", async () => {
    const { fake, client } = setup({ noInput: true });
    const result = client.chat("Prompt text", {});
    await until(() => fake.bar() && fake.bar().mode === "fallback");
    expect(fake.state.clipboard).toBe("Prompt text");
    // The user pastes, sends, and clicks Copilot's Copy button.
    fake.state.clipboard = "Copied answer";
    await client._onBarAction("use");
    await expect(result).resolves.toBe("Copied answer");
  });

  test("Cancel rejects the request", async () => {
    const { fake, client } = setup();
    const result = client.chat("Prompt", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    await client._onBarAction("cancel");
    await expect(result).rejects.toThrow(/Cancelled/);
  });

  test("closing the window rejects the request", async () => {
    const { fake, client } = setup();
    const result = client.chat("Prompt", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    fake.win().destroy();
    await expect(result).rejects.toThrow(/window was closed/);
  });

  test("a newer request replaces one still waiting", async () => {
    const { fake, client } = setup();
    const first = client.chat("First", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    const second = client.chat("Second", {});
    await expect(first).rejects.toThrow(/newer/);
    await client._onBarAction("cancel");
    await expect(second).rejects.toThrow(/Cancelled/);
  });

  test("refuses a prompt longer than the site takes", async () => {
    const { client } = setup();
    await expect(client.chat("x".repeat(10001), { aiWebSite: "copilot-consumer" })).rejects.toThrow(/10,001 characters/);
  });

  test("a custom site needs an address", async () => {
    const { client } = setup();
    await expect(client.chat("hi", { aiWebSite: "custom" })).rejects.toThrow(/address/);
  });

  test("only clipboard writes are allowed for the site", () => {
    const { fake, client } = setup();
    client.open({});
    const answers = [];
    fake.ses.permissionHandler(null, "media", (ok) => answers.push(ok));
    fake.ses.permissionHandler(null, "clipboard-sanitized-write", (ok) => answers.push(ok));
    expect(answers).toEqual([false, true]);
  });

  test("pop-ups and navigation are limited to https", () => {
    const { fake, client } = setup();
    client.open({});
    const view = fake.win().child.webContents;
    expect(view.openHandler({ url: "https://login.microsoftonline.com/x" }).action).toBe("allow");
    expect(view.openHandler({ url: "file:///etc/passwd" }).action).toBe("deny");
    const navEvent = { preventDefault: jest.fn() };
    view.emit("will-navigate", navEvent, "file:///c:/x");
    expect(navEvent.preventDefault).toHaveBeenCalled();
  });

  test("bar links are caught, never loaded", async () => {
    const { fake, client } = setup();
    const result = client.chat("Prompt", {});
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    const navEvent = { preventDefault: jest.fn() };
    fake.win().webContents.emit("will-navigate", navEvent, "https://msp-copilot.invalid/cancel");
    expect(navEvent.preventDefault).toHaveBeenCalled();
    await expect(result).rejects.toThrow(/Cancelled/);
  });

  test("sign out clears the site's session", async () => {
    const { fake, client } = setup();
    client.open({});
    await client.signOut();
    expect(fake.state.cleared).toBe(1);
    expect(fake.win().destroyed).toBe(true);
  });
});

describe("copilot-web hands-off requests", () => {
  test("sends by itself and returns the finished reply without showing the window", async () => {
    const { page, fake, client } = setup();
    page.sendButton.click = () => { page.addReply("Automatic answer"); };
    const reply = await client.chat("Prompt", { aiWebAutoSend: true });
    expect(reply).toBe("Automatic answer");
    expect(fake.win().visible).toBe(false);
  });

  test("hands over to the user when it can't send", async () => {
    const { page, fake, client } = setup();
    page.sendButton.disabled = true;
    const result = client.chat("Prompt", { aiWebAutoSend: true });
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    expect(fake.bar().text).toMatch(/Couldn't send automatically/);
    expect(fake.win().visible).toBe(true);
    page.addReply("Manual answer");
    await client._onBarAction("use");
    await expect(result).resolves.toBe("Manual answer");
  });

  test("hands over to the user when the page never loads (signed out)", async () => {
    const { fake, client } = setup({ noInput: true });
    const result = client.chat("Prompt", { aiWebAutoSend: true });
    await until(() => fake.bar() && fake.bar().mode === "fallback");
    expect(fake.bar().text).toMatch(/didn't load/);
    expect(fake.state.clipboard).toBe("Prompt");
    expect(fake.win().visible).toBe(true);
    await client._onBarAction("cancel");
    await expect(result).rejects.toThrow(/Cancelled/);
  });
});

describe("copilot-web hands-off on a changed page", () => {
  test("types from inside the page when Electron's typing doesn't land (hidden window)", async () => {
    const { page, fake, client } = setup();
    const result = client.chat("Prompt", { aiWebAutoSend: true });
    // Electron's insertText reaches nothing while the window is hidden.
    await until(() => fake.state.windows[0] && fake.state.windows[0].child);
    fake.state.windows[0].child.webContents.insertText = () => {};
    page.sendButton.click = () => { page.addReply("Answer"); };
    await expect(result).resolves.toBe("Answer");
    expect(page.input.value).toBe("Prompt");
  });

  test("types and presses Enter through DevTools in the hidden window", async () => {
    const { page, fake, client } = setup();
    const sent = [];
    let editorHasText = false;
    const result = client.chat("Prompt", { aiWebAutoSend: true });
    await until(() => fake.state.windows[0] && fake.state.windows[0].child);
    const wc = fake.state.windows[0].child.webContents;
    wc.insertText = () => {}; // Electron's typing doesn't reach a hidden window
    let attached = false;
    wc.debugger = {
      isAttached: () => attached,
      attach: () => { attached = true; },
      sendCommand: async (method, params) => {
        sent.push(method);
        if (method === "Input.insertText") { page.input.value = params.text; editorHasText = true; }
        if (method === "Input.dispatchKeyEvent" && params.type === "keyDown" && params.key === "Enter" && editorHasText) {
          page.addReply("Answer via DevTools");
        }
      },
    };
    page.sendButton.click = () => {}; // Copilot's Send ignores the click here
    await expect(result).resolves.toBe("Answer via DevTools");
    expect(sent[0]).toBe("Emulation.setFocusEmulationEnabled");
    expect(sent).toContain("Input.insertText");
  });

  test("presses Enter when the Send button does nothing", async () => {
    const { page, client } = setup();
    page.sendButton.click = () => {};
    page.input.addEventListener("keydown", (e) => { if (e.key === "Enter") page.addReply("Sent with Enter"); });
    await expect(client.chat("Prompt", { aiWebAutoSend: true })).resolves.toBe("Sent with Enter");
  });

  test("finds replies by their Copy buttons when no reply selector matches", async () => {
    const { page, client } = setup();
    const message = (who, text) => {
      const box = el("div.msg", { children: [el("p", { text }), el("button", { attrs: { "aria-label": "Copy" } })] });
      page.thread.appendChild(box);
    };
    message("bot", "Hi there");
    page.sendButton.click = () => {
      message("user", "Prompt");
      message("bot", "Reply from a redesigned page");
    };
    await expect(client.chat("Prompt", { aiWebAutoSend: true })).resolves.toBe("Reply from a redesigned page");
  });

  test("never takes the user's own message for the reply", () => {
    expect(web.isPromptEcho("Prompt", " Prompt ")).toBe(true);
    expect(web.isPromptEcho("A".repeat(50) + " shown shortened", "A".repeat(80))).toBe(true);
    expect(web.isPromptEcho("Answer", "Prompt")).toBe(false);
    expect(web.pickReply({ selection: "", probe: { replyCount: 1, lastReply: "Prompt" }, base: { replyCount: 0, lastReply: "" }, clipboard: "", clipboardAtStart: "", prompt: "Prompt" })).toBe("");
  });

  test("logs the page's layout, without message text, when it can't send", async () => {
    const { page, fake, client, api } = setup();
    page.sendButton.disabled = true;
    page.addReply("Secret ticket text");
    const result = client.chat("Prompt", { aiWebAutoSend: true });
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    const line = api.log.mock.calls.map((c) => c.join(" ")).find((l) => /couldn't send/.test(l));
    expect(line).toMatch(/aria-label=\\"Send\\"/);
    expect(line).not.toMatch(/Secret ticket text/);
    await client._onBarAction("details");
    expect(JSON.parse(fake.state.clipboard).page).toBe("copilot.cloud.microsoft/chat");
    expect(fake.bar().text).toMatch(/Page details copied/);
    await client._onBarAction("cancel");
    await expect(result).rejects.toThrow(/Cancelled/);
  });
});

describe("copilot-web Windows device sign-on", () => {
  function withSso(available) {
    const page = copilotPage();
    const fake = fakeElectron(page);
    const c = clock();
    const windowsSso = {
      setForPartition: jest.fn((partition, on) => !!on),
      isAvailable: jest.fn(async () => available),
    };
    const client = web.createCopilotWeb({ log: jest.fn(), windowsSso }, { electron: fake.electron, now: c.now, sleep: c.sleep });
    return { client, windowsSso, fake };
  }

  test("is turned on for the Copilot session by default when opening", () => {
    const { client, windowsSso } = withSso(true);
    client.open({});
    expect(windowsSso.setForPartition).toHaveBeenCalledWith(web.PARTITION, true);
  });

  test("the setting turns it off", async () => {
    const { client, windowsSso, fake } = withSso(true);
    const result = client.chat("Prompt", { aiWebDeviceSso: false });
    expect(windowsSso.setForPartition).toHaveBeenCalledWith(web.PARTITION, false);
    await until(() => fake.bar() && fake.bar().mode === "waiting");
    await client._onBarAction("cancel");
    await expect(result).rejects.toThrow(/Cancelled/);
  });

  test("reports whether this MSP++ and this PC have it", async () => {
    expect(await withSso(true).client.deviceSsoStatus()).toEqual({ supported: true, available: true });
    expect(await withSso(false).client.deviceSsoStatus()).toEqual({ supported: true, available: false });
    const { client } = setup();
    expect(await client.deviceSsoStatus()).toEqual({ supported: false, available: false });
    expect(client.applyDeviceSso({})).toBe(false);
  });

  test("an error from the app is logged, not thrown", () => {
    const page = copilotPage();
    const fake = fakeElectron(page);
    const api = { log: jest.fn(), windowsSso: { setForPartition: () => { throw new Error("belongs to another plugin"); }, isAvailable: async () => false } };
    const client = web.createCopilotWeb(api, { electron: fake.electron });
    expect(client.applyDeviceSso({})).toBe(false);
    expect(api.log).toHaveBeenCalled();
  });
});
