"use strict";

// The ConnectWise Manage adapter's page scripts run against the stub page in
// test/page-dom.js: reading and pushing notes (the Draft.js time-entry editor
// and the stopwatch popup's textarea), the watcher, reply insert and context,
// the time entry hours fill, ticket detection and the notes scrape.
// test/connectwise-manage.test.js covers the URL helpers and settings.

const cw = require("../plugins/connectwise-manage/renderer");
const { makePage, el, Event } = require("./page-dom");

const PREFIX = cw.WATCHER_PREFIX;

function draftEditor(spec) {
  return el("div.public-DraftEditor-content", Object.assign({ attrs: { contenteditable: "true" } }, spec));
}
function stopwatchTextarea(spec) {
  return el("textarea.cw_PsaResizableTextArea", spec);
}

// The stopwatch button in the header. Clicking it opens the GWT popup with the
// notes textarea, a Save as Draft button and a close icon, like ConnectWise does.
function stopwatchPage({ value = "", opens = true } = {}) {
  const toggle = el("span", { children: [el("div.cwsvg")] });
  const stopwatch = el("div.mm_stopwatch", { children: [toggle] });
  const page = makePage({ body: [stopwatch] });
  const popup = {};
  toggle.addEventListener("click", () => {
    if (!opens || popup.el) return;
    popup.textarea = stopwatchTextarea({ value });
    popup.save = el("div.mm_button", { text: "Save as Draft" });
    popup.close = el("div.cwsvg.mm_icon");
    popup.saved = 0;
    popup.closed = 0;
    popup.save.addEventListener("click", () => { popup.saved++; });
    popup.close.addEventListener("click", () => { popup.closed++; });
    popup.el = el("div.cw-gxt-wnd", { children: [popup.textarea, el("div.cw_confirmButton", { children: [popup.save] }), popup.close] });
    page.body.appendChild(popup.el);
  });
  return { page, toggle, popup };
}

describe("connectwise notes read script", () => {
  test("reads a time-entry editor hidden by GWT, then hides it again", async () => {
    const draft = draftEditor({ text: " Replaced the toner.\n\n\n\nTested.\n" });
    const tab = el("div", { style: { display: "none" }, children: [el("div", { children: [draft] })] });
    const page = makePage({ body: [tab] });
    expect(await page.run(cw.NOTES_READ_SCRIPT)).toEqual({ type: "draft", text: "Replaced the toner.\n\nTested." });
    expect(tab.style.display).toBe("none");
  });

  test("reads the stopwatch textarea already open on screen and leaves it open", async () => {
    const { page, popup } = stopwatchPage({ value: "  Onsite visit " });
    page.body.appendChild(el("div.cw-gxt-wnd", { children: [stopwatchTextarea({ value: "  Onsite visit " })] }));
    expect(await page.run(cw.NOTES_READ_SCRIPT)).toEqual({ type: "textarea", text: "Onsite visit" });
    expect(popup.el).toBeUndefined();
  });

  test("opens the stopwatch hidden to read it, then saves the draft and closes it", async () => {
    const { page, popup } = stopwatchPage({ value: "Called the user\n\n\n\nback" });
    expect(await page.run(cw.NOTES_READ_SCRIPT)).toEqual({ type: "textarea", text: "Called the user\n\nback" });
    // The popup was hidden while it opened, then shown again so GWT takes the clicks.
    expect(popup.el.classList.contains("cw-sync-hidden")).toBe(false);
    expect(popup.saved).toBe(1);
    expect(popup.closed).toBe(1);
    // The hiding rule is removed again.
    expect(page.head.children).toHaveLength(0);
  });

  test("null when there is no editor and no stopwatch", async () => {
    expect(await makePage({ body: [el("div", { text: "Service board" })] }).run(cw.NOTES_READ_SCRIPT)).toBeNull();
  });

  test("gives up after about two seconds when the stopwatch never opens, and cleans up", async () => {
    const { page } = stopwatchPage({ opens: false });
    const started = Date.now();
    expect(await page.run(cw.NOTES_READ_SCRIPT)).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(page.head.children).toHaveLength(0);
  });
});

describe("connectwise notes push script", () => {
  test("pastes into the time-entry editor", async () => {
    const draft = draftEditor({ text: "old" });
    const page = makePage({ body: [draft] });
    const pastes = [];
    draft.addEventListener("paste", (e) => pastes.push(e.clipboardData.getData("text/plain")));
    expect(await page.run(cw.buildPushScript("New note\nline 2"))).toEqual({ type: "draft" });
    expect(pastes).toEqual(["New note\nline 2"]);
    expect(page.document.activeElement).toBe(draft);
  });

  test("makes Draft.js see a select-all, so the paste replaces the note instead of adding to it", async () => {
    class SelectionState { constructor(spec) { Object.assign(this, spec); } }
    const cursor = new SelectionState({ anchorKey: "b2", anchorOffset: 3, focusKey: "b2", focusOffset: 3 });
    const editorState = { getSelection: () => cursor, getCurrentContent: () => "content", selectionNow() { return this.getSelection(); } };
    const editorComponent = { _latestEditorState: editorState };
    const draft = draftEditor({
      children: [
        el("div", { attrs: { "data-block": "true", "data-offset-key": "a1x-0-0" }, text: "first line" }),
        el("div", { attrs: { "data-block": "true", "data-offset-key": "b2y-0-0" }, text: "last" }),
      ],
    });
    draft["__reactFiber$k3j"] = { stateNode: null, return: { stateNode: editorComponent, return: null } };
    const page = makePage({ body: [draft] });
    let seen = null;
    draft.addEventListener("paste", () => { seen = editorComponent._latestEditorState.getSelection(); });

    await page.run(cw.buildPushScript("replacement"));
    expect(seen).toBeInstanceOf(SelectionState);
    expect(seen).toMatchObject({ anchorKey: "a1x", anchorOffset: 0, focusKey: "b2y", focusOffset: 4, isBackward: false, hasFocus: true });
    // Everything else still reads through to the real editor state.
    const proxied = editorComponent._latestEditorState;
    expect(proxied.getCurrentContent()).toBe("content");
    expect(proxied.selectionNow()).toBe(seen);
  });

  test("falls back to select-all and insertText where a paste event can't be built", async () => {
    const draft = draftEditor({ text: "old" });
    const page = makePage({ body: [draft], clipboard: false });
    expect(await page.run(cw.buildPushScript("typed"))).toEqual({ type: "draft" });
    expect(page.document.commands).toEqual([["selectAll", null], ["insertText", "typed"]]);
  });

  test("focuses the new editor when ConnectWise swaps it out during the paste", async () => {
    const draft = draftEditor();
    const page = makePage({ body: [draft] });
    const replacement = draftEditor();
    draft.addEventListener("paste", () => { draft.remove(); page.body.appendChild(replacement); });
    await page.run(cw.buildPushScript("x"));
    expect(page.document.activeElement).toBe(replacement);
  });

  test("writes the stopwatch textarea through the popup and saves it as a draft", async () => {
    const { page, popup } = stopwatchPage({ value: "old" });
    expect(await page.run(cw.buildPushScript("Fixed \"it\" `now` ${x}"))).toEqual({ type: "textarea" });
    expect(popup.textarea.value).toBe("Fixed \"it\" `now` ${x}");
    expect(popup.textarea.eventTypes().filter((t) => t === "input" || t === "change")).toEqual(["input", "change"]);
    expect(popup.saved).toBe(1);
    expect(popup.closed).toBe(1);
  });

  test("null when there is nowhere to write", async () => {
    expect(await makePage().run(cw.buildPushScript("x"))).toBeNull();
  });

  test("a missing text clears the field rather than writing the word undefined", async () => {
    const page = makePage({ body: [el("div.cw-gxt-wnd", { children: [stopwatchTextarea({ value: "old" })] })] });
    await page.run(cw.buildPushScript(undefined));
    expect(page.document.querySelector("textarea").value).toBe("");
  });
});

describe("connectwise reply insert script", () => {
  test("pastes into a visible time-entry editor", () => {
    const draft = draftEditor();
    const page = makePage({ body: [draft] });
    const pastes = [];
    draft.addEventListener("paste", (e) => pastes.push(e.clipboardData.getData("text/plain")));
    expect(page.run(cw.buildReplyInsertScript("Hi Dana"))).toEqual({ type: "draft" });
    expect(pastes).toEqual(["Hi Dana"]);
    expect(page.document.commands).toEqual([]);
  });

  test("types the text where a paste event can't be built", () => {
    const page = makePage({ body: [draftEditor()], clipboard: false });
    expect(page.run(cw.buildReplyInsertScript("Hi"))).toEqual({ type: "draft" });
    expect(page.document.commands).toEqual([["insertText", "Hi"]]);
  });

  test("inserts at the caret of an open stopwatch textarea, never opening a hidden one", () => {
    const ta = stopwatchTextarea({ value: "Spoke to X today", selectionStart: 9, selectionEnd: 10 });
    const page = makePage({ body: [el("div", { style: { display: "none" }, children: [draftEditor()] }), ta] });
    expect(page.run(cw.buildReplyInsertScript("Dana"))).toEqual({ type: "textarea" });
    expect(ta.value).toBe("Spoke to Dana today");
    expect([ta.selectionStart, ta.selectionEnd]).toEqual([13, 13]);

    const hidden = makePage({ body: [el("div", { style: { display: "none" }, children: [stopwatchTextarea()] })] });
    expect(hidden.run(cw.buildReplyInsertScript("x"))).toBeNull();
    const { page: closed, popup } = stopwatchPage();
    expect(closed.run(cw.buildReplyInsertScript("x"))).toBeNull();
    expect(popup.el).toBeUndefined();
  });
});

describe("connectwise reply context", () => {
  function field(label, value, wrap) {
    const input = el("input", { attrs: { type: "text" }, value });
    const row = el("div", { children: [el("label", { text: label }), input] });
    return wrap ? el("div", { children: [el("div", { children: [row] })] }) : row;
  }

  test("reads the contact and summary next to their labels", () => {
    const page = makePage({
      body: [
        field("Company:", "Acme"),
        field("Contact:", "  Dana   Reyes "),
        el("div", { children: [el("div", { children: [el("span.gwt-Label", { text: "Summary Description" })] }), el("textarea", { value: "VPN drops\nevery hour" })] }),
      ],
    });
    expect(page.run(cw.REPLY_CONTEXT_SCRIPT)).toEqual({ requester: "Dana Reyes", subject: "VPN drops every hour" });
  });

  test("skips empty inputs and labels that only start with the word", () => {
    const page = makePage({ body: [field("Contact:", ""), field("Contact Email:", "dana@acme.test"), field("Summary", "")] });
    expect(page.run(cw.REPLY_CONTEXT_SCRIPT)).toEqual({ requester: "", subject: "" });
  });

  test("readContext passes on what the page gives and never throws", async () => {
    expect(await cw.adapter.reply.readContext({ webview: { executeJavaScript: async () => ({ requester: "Dana" }) } })).toEqual({ requester: "Dana" });
    expect(await cw.adapter.reply.readContext({ webview: { executeJavaScript: async () => "odd" } })).toEqual({});
    expect(await cw.adapter.reply.readContext({ webview: { executeJavaScript: async () => { throw new Error("tab closed"); } } })).toEqual({});
    expect(await cw.adapter.reply.readContext({})).toEqual({});
    expect(await cw.adapter.reply.readContext(undefined)).toEqual({});
  });
});

describe("connectwise notes watcher", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("reports the editor, focus and typing, once installed", () => {
    const draft = draftEditor({ text: "Ca" });
    const page = makePage({ body: [draft] });
    page.run(cw.WATCHER_SCRIPT);
    page.run(cw.WATCHER_SCRIPT);
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "draft" }]);

    page.logs.length = 0;
    draft.focus();
    draft.dispatchEvent(new Event("input"));
    jest.advanceTimersByTime(100);
    draft.textContent = "Called ";
    draft.dispatchEvent(new Event("input"));
    jest.advanceTimersByTime(150);
    draft.blur();
    expect(page.messages(PREFIX)).toEqual([
      { kind: "focus", field: "draft", focused: true },
      { kind: "input", field: "draft", text: "Called" },
      { kind: "focus", field: "draft", focused: false },
    ]);
  });

  test("picks up the stopwatch textarea and reports the popup showing and hiding", () => {
    const page = makePage();
    page.run(cw.WATCHER_SCRIPT);
    expect(page.messages(PREFIX)).toEqual([]);

    const ta = stopwatchTextarea({ value: "x" });
    const popup = el("div.cw-gxt-wnd", { children: [ta] });
    page.body.appendChild(popup);
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "textarea" }, { kind: "popup", visible: true }]);

    page.logs.length = 0;
    ta.value = "Onsite ";
    ta.dispatchEvent(new Event("input"));
    jest.advanceTimersByTime(150);
    // Hidden by the read/push scripts' own class: not "visible" to the user.
    popup.classList.add("cw-sync-hidden");
    page.mutate();
    expect(page.messages(PREFIX)).toEqual([{ kind: "input", field: "textarea", text: "Onsite" }, { kind: "popup", visible: false }]);
  });

  test("the popup state feeds the push delay", () => {
    const state = {};
    cw.onWatcherMessage({ kind: "popup", visible: true }, state);
    expect(cw.pushDelay("textarea", state)).toBe(100);
    cw.onWatcherMessage({ kind: "popup", visible: false }, state);
    expect(cw.pushDelay("textarea", state)).toBe(2000);
    cw.onWatcherMessage({ kind: "input" }, state);
    cw.onWatcherMessage(null, state);
    cw.onWatcherMessage({ kind: "popup", visible: true }, null);
    expect(state).toEqual({ popupVisible: false });
  });
});

describe("connectwise time entry fill script", () => {
  const run = (body, hours) => makePage({ body }).run(cw.buildTimeEntryFillScript(hours));

  test("fills an input named like the hours field, with two decimals, and fires its events", () => {
    const hours = el("input", { attrs: { name: "actualHours" } });
    const res = run([el("input", { attrs: { name: "summary" } }), hours], 1.256);
    expect(res).toEqual({ field: "actualHours" });
    expect(hours.value).toBe("1.26");
    expect(hours.eventTypes()).toEqual(expect.arrayContaining(["input", "change", "keyup", "blur"]));
  });

  test("finds the input next to an \"Actual Hours\" label when it has no telling name", () => {
    const hours = el("input", { attrs: { id: "gwt-uid-77" } });
    const body = [el("div", { children: [el("div", { children: [el("span", { text: "Actual Hours: *" })] }), el("div", { children: [hours] })] })];
    expect(run(body, 0.5)).toEqual({ field: "Actual Hours: *" });
    expect(hours.value).toBe("0.50");
  });

  test("follows a label's for attribute", () => {
    const hours = el("input", { attrs: { id: "hrs" } });
    const body = [el("label", { attrs: { for: "hrs" }, text: "Hours" }), el("div", { children: [hours, el("input", { attrs: { id: "other" } })] })];
    expect(run(body, 2)).toEqual({ field: "Hours" });
    expect(hours.value).toBe("2.00");
  });

  test("skips hidden, disabled, read-only and non-text inputs", () => {
    const body = [
      el("div", { style: { display: "none" }, children: [el("input", { attrs: { name: "actualHours" } })] }),
      el("input", { attrs: { name: "hours" }, disabled: true }),
      el("input", { attrs: { name: "hoursWorked" }, readOnly: true }),
      el("input", { attrs: { name: "hours", type: "checkbox" } }),
    ];
    expect(run(body, 1).error).toMatch(/Open a new time entry/);
  });

  test("leaves a label alone when it can't tell which of several inputs is meant", () => {
    const body = [el("div", { children: [el("span", { text: "Hours" }), el("input", { attrs: { id: "a" } }), el("input", { attrs: { id: "b" } })] })];
    const page = makePage({ body });
    expect(page.run(cw.buildTimeEntryFillScript(1)).error).toMatch(/No hours field/);
    expect(page.document.querySelectorAll("input").map((i) => i.value)).toEqual(["", ""]);
  });

});

describe("connectwise ticket detection and notes scrape", () => {
  test("finds the ticket in an input labelled as the ticket number", () => {
    const page = makePage({
      body: [el("input", { attrs: { "aria-label": "Service Ticket Number" }, value: "1234567" })],
    });
    expect(page.run(cw.RECORD_SCRIPT)).toMatchObject({ ticket: "CW-1234567", source: "input-label" });
  });

  test("reads the ticket number from hash parameters on the newer screens", () => {
    const page = makePage({ url: "https://na.myconnectwise.net/v4_6_release/ConnectWise.aspx#srRecID=998877&tab=notes" });
    expect(page.run(cw.RECORD_SCRIPT)).toMatchObject({ ticket: "CW-998877", source: "url" });
  });

  test("the scrape keeps each note's author and date", () => {
    const date = el("span.TimeText-date", { children: ["11/16/2026", el("b", { text: "(edited)" }), " 9:05 AM"] });
    const note = el("div.TicketNote-rowWrap", {
      children: [
        el("a.TicketNote-clickableName", { text: " Dana Reyes " }),
        date,
        el("div.TicketNote-noteLabel", { text: " Rebooted the router. " }),
      ],
    });
    const anonymous = el("div.TicketNote-row", { children: [el("div.TicketNote-noteLabel", { text: "Customer called back." })] });
    const page = makePage({ body: [note, el("div.TicketNote-noteLabel", { text: "   " }), anonymous] });
    expect(page.run(cw.SCRAPE_SCRIPT))
      .toBe("[Dana Reyes — 11/16/2026 9:05 AM]\nRebooted the router.\n\n---\n\nCustomer called back.");
  });

  test("the scrape is empty on a page without notes and stops at 15,000 characters", () => {
    expect(makePage().run(cw.SCRAPE_SCRIPT)).toBe("");
    const long = makePage({ body: [el("div.TicketNote-noteLabel", { text: "n".repeat(20000) })] });
    expect(long.run(cw.SCRAPE_SCRIPT)).toHaveLength(15000);
  });
});

describe("connectwise time entry fill (adapter)", () => {
  test("refuses tabs that aren't ConnectWise and reports a page that can't be reached", async () => {
    const webview = { executeJavaScript: jest.fn(async () => ({ field: "Hours" })) };
    expect((await cw.fillTimeEntry({ webview, url: "https://acme.freshservice.com/a/tickets/1", minutes: 30 })).error).toMatch(/ConnectWise tab/);
    expect(webview.executeJavaScript).not.toHaveBeenCalled();
    const broken = { executeJavaScript: async () => { throw new Error("webview gone"); } };
    expect(await cw.fillTimeEntry({ webview: broken, url: "https://na.myconnectwise.net/", minutes: 30 }))
      .toEqual({ error: "Couldn't reach the ConnectWise page: webview gone" });
    const empty = { executeJavaScript: async () => null };
    expect(await cw.fillTimeEntry({ webview: empty, url: "https://na.myconnectwise.net/", minutes: 30 }))
      .toEqual({ error: "No hours field was found on the page." });
  });

  test("passes the minutes as hours to the page script", async () => {
    const webview = { executeJavaScript: jest.fn(async () => ({})) };
    const res = await cw.fillTimeEntry({ webview, url: "https://na.myconnectwise.net/", minutes: 45 });
    expect(webview.executeJavaScript.mock.calls[0][0]).toContain('var value = "0.75";');
    expect(res.message).toBe("Filled 0.75 hours into the hours field. Check it and save the time entry in ConnectWise.");
    // Missing or odd minutes fill 0.00, never "NaN".
    await cw.fillTimeEntry({ webview, url: "https://na.myconnectwise.net/", minutes: "soon" });
    expect(webview.executeJavaScript.mock.calls[1][0]).toContain('var value = "0.00";');
  });
});

describe("connectwise plugin in the window", () => {
  const fs = require("fs");
  const path = require("path");
  const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/connectwise-manage/renderer.js"), "utf-8");

  function loadInWindow(pluginAPI) {
    global.window = { pluginAPI };
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Run as a browser script: no module object.
      new Function("module", SOURCE)(undefined);
    } finally {
      delete global.window;
    }
    const warnings = warn.mock.calls.length;
    warn.mockRestore();
    return warnings;
  }

  test("registers the frozen adapter and follows the Custom URL setting", () => {
    let registered = null;
    let onSettings = null;
    loadInWindow({
      sites: { register: (a) => { registered = a; } },
      getSettings: () => ({ cwCustomHost: "cw.acme.com" }),
      events: { on: (name, fn) => { if (name === "settings:changed") onSettings = fn; } },
    });
    expect(registered.id).toBe("connectwise-manage");
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.notes)).toBe(true);
    expect(registered.matchesUrl("https://cw.acme.com/v4_6_release/")).toBe(true);
    onSettings({ cwCustomHost: "" });
    expect(registered.matchesUrl("https://cw.acme.com/v4_6_release/")).toBe(false);
    onSettings(null);
    expect(registered.matchesUrl("https://na.myconnectwise.net/")).toBe(true);
  });

  test("still registers when settings can't be read yet", () => {
    let registered = null;
    loadInWindow({ sites: { register: (a) => { registered = a; } }, getSettings: () => { throw new Error("not ready"); } });
    expect(registered.id).toBe("connectwise-manage");
  });

  test("warns and stays inactive on an app without the site API", () => {
    expect(loadInWindow({})).toBe(1);
    expect(loadInWindow(undefined)).toBe(1);
  });
});
