"use strict";

// The Freshservice site adapter's page scripts (note editor read / push / watch,
// reply insert, reply context, record text) run against the stub page in
// test/page-dom.js, and the adapter's calls into the plugin's API handlers
// (reply context, time entries, ticket search, quick actions, preview,
// Solutions). test/freshservice-site.test.js covers URL matching, record
// detection and links.

const fs = require("fs");
const path = require("path");
const { makePage, el, Event } = require("./page-dom");

const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/freshservice/renderer.js"), "utf-8");

function loadAdapter({ settings = {}, invoke, tabs } = {}) {
  let adapter = null;
  const listeners = {};
  const calls = [];
  global.window = {
    pluginAPI: {
      sites: { register: (a) => { adapter = a; return a; }, list: () => (adapter ? [adapter] : []) },
      getSettings: () => Object.assign({}, settings),
      events: { on: (name, fn) => { listeners[name] = fn; } },
      invoke: async (plugin, action, data) => {
        calls.push([plugin, action, data]);
        return invoke ? invoke(action, data) : {};
      },
      browser: { getTabs: () => { if (!tabs) throw new Error("no tabs yet"); return tabs.map((t) => Object.assign({}, t)); } },
    },
  };
  try {
    new Function(SOURCE)();
  } finally {
    delete global.window;
  }
  return { adapter, listeners, calls };
}

const { adapter } = loadAdapter();
const notes = adapter.notes;

function froalaEditor(spec) {
  return el("div.fr-element.fr-view", Object.assign({ attrs: { contenteditable: "true" } }, spec));
}
function noteTextarea(spec) {
  return el("textarea", Object.assign({ attrs: { name: "time_entry[note]" } }, spec));
}
// A Froala instance as the push scripts use it.
function froalaInstance(editor) {
  return {
    el: editor,
    html: { set: jest.fn(), insert: jest.fn() },
    undo: { saveStep: jest.fn() },
    events: { trigger: jest.fn() },
  };
}

describe("freshservice notes read script", () => {
  test("null when the page has no notes field", () => {
    const page = makePage({ body: [el("textarea", { attrs: { name: "subject" } }), el("div", { text: "Ticket list" })] });
    expect(page.run(notes.readScript)).toBeNull();
  });

  test("reads the visible editor and tidies the text like the Notes tab", () => {
    const page = makePage({ body: [froalaEditor({ text: " Called the user.\n\n\n\nWaiting on parts.\n" })] });
    expect(page.run(notes.readScript)).toEqual({ type: "editor", text: "Called the user.\n\nWaiting on parts." });
  });

  test("skips editors that are hidden or not editable", () => {
    const hidden = el("div", { style: { display: "none" }, children: [froalaEditor({ text: "old reply" })] });
    const readOnly = el("div.fr-element", { attrs: { contenteditable: "false" }, text: "sent reply" });
    const page = makePage({ body: [hidden, readOnly, el("div.redactor-editor", { attrs: { contenteditable: "true" }, text: "legacy note" })] });
    expect(page.run(notes.readScript)).toEqual({ type: "editor", text: "legacy note" });
  });

  test("a textarea counts only when it is about notes and can be typed in", () => {
    const page = makePage({
      body: [
        el("textarea", { attrs: { name: "description" }, value: "not this" }),
        noteTextarea({ value: "locked", readOnly: true }),
        noteTextarea({ value: "off", disabled: true }),
        el("textarea", { attrs: { "aria-label": "Add a Note" }, value: " 30 min on site " }),
      ],
    });
    expect(page.run(notes.readScript)).toEqual({ type: "textarea", text: "30 min on site" });
  });

  test("an editor is preferred to a note textarea when neither has focus", () => {
    const page = makePage({ body: [noteTextarea({ value: "time note" }), froalaEditor({ text: "reply" })] });
    expect(page.run(notes.readScript)).toEqual({ type: "editor", text: "reply" });
  });

  test("the focused field wins, also when focus is on something inside the editor", () => {
    const paragraph = el("p", { text: "second editor" });
    const second = froalaEditor({ children: [paragraph] });
    const textarea = noteTextarea({ value: "time note" });
    const page = makePage({ body: [froalaEditor({ text: "first editor" }), second, textarea] });

    page.document.activeElement = paragraph;
    expect(page.run(notes.readScript)).toEqual({ type: "editor", text: "second editor" });
    textarea.focus();
    expect(page.run(notes.readScript)).toEqual({ type: "textarea", text: "time note" });
  });

  test("the field the user last clicked into wins over the first one on the page", () => {
    const marked = froalaEditor({ text: "note being written", attrs: { contenteditable: "true", "data-fspp-sync": "1" } });
    const wrap = el("div", { children: [marked] });
    const page = makePage({ body: [froalaEditor({ text: "reply box" }), wrap] });
    expect(page.run(notes.readScript).text).toBe("note being written");
    // Once that field is closed (hidden), the first visible one is used again.
    wrap.style.display = "none";
    expect(page.run(notes.readScript).text).toBe("reply box");
  });
});

describe("freshservice notes push script", () => {
  test("null when there is nowhere to write", () => {
    expect(makePage().run(notes.buildPushScript("hello"))).toBeNull();
  });

  test("a note textarea gets the text and the events a form framework listens for", () => {
    const textarea = noteTextarea({ value: "old" });
    const page = makePage({ body: [textarea] });
    expect(page.run(notes.buildPushScript("line one\nline \"two\""))).toEqual({ type: "textarea" });
    expect(textarea.value).toBe("line one\nline \"two\"");
    expect(page.document.activeElement).toBe(textarea);
    expect(textarea.eventTypes().filter((t) => t === "input" || t === "change")).toEqual(["input", "change"]);
  });

  test("Froala gets one escaped paragraph with <br> line breaks and its change hooks", () => {
    const editor = froalaEditor({ text: "old" });
    const page = makePage({ body: [editor] });
    const other = froalaInstance(froalaEditor());
    const inst = froalaInstance(editor);
    page.window.FroalaEditor = { INSTANCES: [null, other, inst] };

    expect(page.run(notes.buildPushScript("a < b & c > d\nnext"))).toEqual({ type: "editor" });
    expect(inst.html.set).toHaveBeenCalledWith("<p>a &lt; b &amp; c &gt; d<br>next</p>");
    expect(inst.undo.saveStep).toHaveBeenCalledTimes(1);
    expect(inst.events.trigger).toHaveBeenCalledWith("contentChanged");
    expect(other.html.set).not.toHaveBeenCalled();
    expect(editor.eventTypes()).toContain("input");
    // The Froala path never falls through to the raw DOM write.
    expect(editor.innerHTML).toBe("");
    expect(page.document.commands).toEqual([]);
  });

  test("an empty note clears the editor to an empty paragraph", () => {
    const editor = froalaEditor({ text: "old" });
    const page = makePage({ body: [editor] });
    const inst = froalaInstance(editor);
    page.window.FroalaEditor = { INSTANCES: [inst] };
    page.run(notes.buildPushScript(""));
    expect(inst.html.set).toHaveBeenCalledWith("<p><br></p>");
  });

  test("the older jQuery Froala plugin is found through the editor's box", () => {
    const editor = froalaEditor({ text: "old" });
    const page = makePage({ body: [editor] });
    const inst = froalaInstance(editor);
    const jq = {
      closest: jest.fn(() => jq),
      prev: jest.fn(() => jq),
      length: 1,
      data: jest.fn(() => inst),
    };
    page.window.jQuery = jest.fn(() => jq);

    expect(page.run(notes.buildPushScript("hi"))).toEqual({ type: "editor" });
    expect(page.window.jQuery).toHaveBeenCalledWith(editor);
    expect(jq.closest).toHaveBeenCalledWith(".fr-box");
    expect(jq.data).toHaveBeenCalledWith("froala.editor");
    expect(inst.html.set).toHaveBeenCalledWith("<p>hi</p>");
  });

  test("without Froala the whole editor is selected and replaced through execCommand", () => {
    const editor = froalaEditor({ text: "old" });
    const page = makePage({ body: [editor] });
    page.document.execCommand = jest.fn(() => true);

    expect(page.run(notes.buildPushScript("new text"))).toEqual({ type: "editor" });
    expect(page.document.execCommand).toHaveBeenCalledWith("insertHTML", false, "<p>new text</p>");
    expect(page.selection.ranges).toHaveLength(1);
    expect(page.selection.ranges[0].contents).toBe(editor);
    // execCommand fires the browser's own input event, so none is added.
    expect(editor.eventTypes()).not.toContain("input");
    expect(editor.eventTypes()).toContain("keyup");
  });

  test("when execCommand refuses or throws, the HTML is written directly", () => {
    for (const execCommand of [() => false, () => { throw new Error("not allowed"); }]) {
      const editor = froalaEditor({ text: "old" });
      const page = makePage({ body: [editor] });
      page.document.execCommand = execCommand;
      expect(page.run(notes.buildPushScript("new"))).toEqual({ type: "editor" });
      expect(editor.innerHTML).toBe("<p>new</p>");
      expect(editor.eventTypes()).toEqual(expect.arrayContaining(["input", "keyup"]));
    }
  });

  test("a Froala error falls back to the DOM instead of losing the push", () => {
    const editor = froalaEditor({ text: "old" });
    const page = makePage({ body: [editor] });
    const inst = froalaInstance(editor);
    inst.html.set.mockImplementation(() => { throw new Error("editor destroyed"); });
    page.window.FroalaEditor = { INSTANCES: [inst] };
    expect(page.run(notes.buildPushScript("new"))).toEqual({ type: "editor" });
    expect(editor.innerHTML).toBe("<p>new</p>");
  });

  test("text that looks like script or template code stays text", () => {
    const editor = froalaEditor();
    const page = makePage({ body: [editor] });
    const text = "</script><img src=x onerror=alert(1)> `${process}` \\n  ";
    page.run(notes.buildPushScript(text));
    expect(editor.innerHTML).toBe("<p>&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; `${process}` \\n  </p>");
  });
});

describe("freshservice reply insert script", () => {
  const insert = adapter.reply.buildInsertScript;

  test("null when no editor is open", () => {
    expect(makePage().run(insert("Hello"))).toBeNull();
  });

  test("a textarea gets the text at the caret, replacing only the selection", () => {
    const textarea = noteTextarea({ value: "Hello NAME, thanks", selectionStart: 6, selectionEnd: 10 });
    const page = makePage({ body: [textarea] });
    expect(page.run(insert("Sean"))).toEqual({ type: "textarea" });
    expect(textarea.value).toBe("Hello Sean, thanks");
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([10, 10]);
    expect(textarea.eventTypes().filter((t) => t === "input" || t === "change")).toEqual(["input", "change"]);
  });

  test("Froala inserts at the caret and never replaces what is there", () => {
    const editor = froalaEditor({ text: "Existing reply" });
    const page = makePage({ body: [editor] });
    const inst = froalaInstance(editor);
    page.window.FroalaEditor = { INSTANCES: [inst] };

    expect(page.run(insert("Hi <there>\nline two"))).toEqual({ type: "editor" });
    expect(inst.html.insert).toHaveBeenCalledWith("Hi &lt;there&gt;<br>line two");
    expect(inst.html.set).not.toHaveBeenCalled();
    expect(inst.events.trigger).toHaveBeenCalledWith("contentChanged");
  });

  test("blank lines become paragraphs", () => {
    const editor = froalaEditor();
    const page = makePage({ body: [editor] });
    const inst = froalaInstance(editor);
    page.window.FroalaEditor = { INSTANCES: [inst] };
    page.run(insert("Hi Sam,\n\nTry this:\nreboot\n\n"));
    expect(inst.html.insert).toHaveBeenCalledWith("<p>Hi Sam,</p><p>Try this:<br>reboot</p><p><br></p>");
  });

  test("the caret moves to the end when it isn't in the editor, and stays when it is", () => {
    const inside = el("p", { text: "typed so far" });
    const editor = froalaEditor({ children: [inside] });
    const page = makePage({ body: [editor, el("div", { text: "elsewhere" })] });

    page.run(insert("x"));
    expect(page.selection.ranges).toHaveLength(1);
    expect(page.selection.ranges[0]).toMatchObject({ contents: editor, collapsed: true, atEnd: true });

    const userCaret = { commonAncestorContainer: inside };
    page.selection.ranges = [userCaret];
    page.run(insert("y"));
    expect(page.selection.ranges).toEqual([userCaret]);
  });

  test("without Froala the text goes through execCommand, then onto the end of the editor", () => {
    const editor = froalaEditor({ text: "Existing" });
    const page = makePage({ body: [editor] });
    page.document.execCommand = jest.fn(() => true);
    expect(page.run(insert("more"))).toEqual({ type: "editor" });
    expect(page.document.execCommand).toHaveBeenCalledWith("insertHTML", false, "more");
    expect(editor.insertedHtml).toEqual([]);

    page.document.execCommand = jest.fn(() => false);
    page.run(insert("again"));
    expect(editor.insertedHtml).toEqual([["beforeend", "again"]]);
    expect(editor.innerHTML).toBe("");
  });

  test("a missing text inserts nothing rather than the word undefined", () => {
    const textarea = noteTextarea({ value: "kept" });
    const page = makePage({ body: [textarea] });
    page.run(insert(undefined));
    expect(textarea.value).toBe("kept");
  });
});

describe("freshservice notes watcher", () => {
  const PREFIX = notes.watcherPrefix;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("reports the field on the page and marks it", () => {
    const editor = froalaEditor({ text: "note" });
    const page = makePage({ body: [editor] });
    page.run(notes.watcherScript);
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "editor" }]);
    expect(editor.getAttribute("data-fspp-sync")).toBe("1");
  });

  test("stays quiet on a page without a field (no field is the starting state), and installs only once", () => {
    const page = makePage();
    page.run(notes.watcherScript);
    page.run(notes.watcherScript);
    expect(page.messages(PREFIX)).toEqual([]);
    expect(page.window.__fsSyncWatcherInstalled).toBe(true);
    // A second copy would send every message twice.
    const editor = froalaEditor();
    page.body.appendChild(editor);
    editor.focus();
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "editor" }, { kind: "focus", focused: true }]);
  });

  test("focusing another field moves the mark and reports the new field type", () => {
    const editor = froalaEditor({ text: "note" });
    const textarea = noteTextarea();
    const page = makePage({ body: [editor, textarea] });
    page.run(notes.watcherScript);
    page.logs.length = 0;

    textarea.focus();
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "textarea" }, { kind: "focus", focused: true }]);
    expect(textarea.getAttribute("data-fspp-sync")).toBe("1");
    expect(editor.getAttribute("data-fspp-sync")).toBeNull();

    page.logs.length = 0;
    textarea.blur();
    expect(page.messages(PREFIX)).toEqual([{ kind: "focus", focused: false }]);
  });

  test("focus on other parts of the page is ignored", () => {
    const search = el("input", { attrs: { name: "search" } });
    const page = makePage({ body: [froalaEditor(), search] });
    page.run(notes.watcherScript);
    page.logs.length = 0;
    search.focus();
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.blur();
    jest.advanceTimersByTime(1000);
    expect(page.messages(PREFIX)).toEqual([]);
  });

  test("typing is sent once, after a pause, with the latest text", () => {
    const paragraph = el("p", { text: "Ca" });
    const editor = froalaEditor({ children: [paragraph] });
    const page = makePage({ body: [editor] });
    page.run(notes.watcherScript);
    page.logs.length = 0;

    paragraph.dispatchEvent(new Event("input", { bubbles: true }));
    jest.advanceTimersByTime(100);
    paragraph.textContent = "Called the user ";
    paragraph.dispatchEvent(new Event("input", { bubbles: true }));
    jest.advanceTimersByTime(149);
    expect(page.messages(PREFIX)).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(page.messages(PREFIX)).toEqual([{ kind: "input", field: "editor", text: "Called the user" }]);
  });

  test("an editor that opens or closes later is picked up after page changes settle", () => {
    const page = makePage();
    page.run(notes.watcherScript);
    page.logs.length = 0;

    const editor = froalaEditor({ text: "reply" });
    page.body.appendChild(editor);
    page.mutate();
    page.mutate();
    expect(page.messages(PREFIX)).toEqual([]);
    jest.advanceTimersByTime(250);
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "editor" }]);

    // Nothing new is sent while the same field stays on screen.
    page.mutate();
    jest.advanceTimersByTime(250);
    expect(page.messages(PREFIX)).toHaveLength(1);

    editor.remove();
    jest.advanceTimersByTime(250);
    expect(page.messages(PREFIX)).toEqual([{ kind: "fields", type: "editor" }, { kind: "fields", type: null }]);
  });
});

describe("freshservice record text scrape", () => {
  test("joins the subject and each stored rich-text block", () => {
    const page = makePage({
      body: [
        el("h1", { text: "  Printer offline " }),
        el("div.fr-view", { text: "The printer on floor 2 is offline." }),
        el("div.fr-view", { text: "  " }),
        el("div.fr-view", { text: "Power-cycled it, back online." }),
      ],
    });
    expect(page.run(adapter.scrapeScript))
      .toBe("Printer offline\n\nThe printer on floor 2 is offline.\n\n---\n\nPower-cycled it, back online.");
  });

  test("leaves out open editors and blocks nested in one already taken", () => {
    const outer = el("div.fr-view", { children: [el("div.fr-view", { text: "quoted reply" })] });
    const page = makePage({
      body: [
        outer,
        froalaEditor({ text: "half-written draft" }),
        el("div", { attrs: { contenteditable: "true" }, children: [el("div.fr-view", { text: "draft in a wrapper" })] }),
      ],
    });
    expect(page.run(adapter.scrapeScript)).toBe("quoted reply");
  });

  test("falls back to the main content area, then the whole page", () => {
    const withMain = makePage({ body: [el("nav", { text: "Menu" }), el("main", { text: " Change details " })] });
    expect(withMain.run(adapter.scrapeScript)).toBe("Change details");
    const plain = makePage({ body: [el("div", { text: "Just text" })] });
    expect(plain.run(adapter.scrapeScript)).toBe("Just text");
  });

  test("stops at 15,000 characters", () => {
    const page = makePage({ body: [el("div.fr-view", { text: "x".repeat(20000) })] });
    expect(page.run(adapter.scrapeScript)).toHaveLength(15000);
  });
});

describe("freshservice reply context", () => {
  const TICKET = { url: "https://acme.freshservice.com/a/tickets/5", record: { kind: "ticket", id: "5" } };
  const pageWebview = (result) => ({ executeJavaScript: jest.fn(async () => result) });

  test("the page script reads the subject and requester, skipping empty and overlong matches", () => {
    const script = pageWebview().executeJavaScript;
    const { adapter: a } = loadAdapter();
    return a.reply.readContext({ webview: { executeJavaScript: async (s) => { script(s); return {}; } } }).then(() => {
      const source = script.mock.calls[0][0];
      const page = makePage({
        body: [
          el("div.ticket-subject-heading", { text: "  " }),
          el("div.ticket-subject", { text: "VPN   drops\nevery hour" }),
          el("h1", { text: "Tickets" }),
          el("div.requester-name", { text: "y".repeat(201) }),
          el("div.requester-info", { children: [el("a", { text: "Dana Reyes" })] }),
        ],
      });
      expect(page.run(source)).toEqual({ subject: "VPN drops every hour", requester: "Dana Reyes" });
      expect(makePage().run(source)).toEqual({ subject: "", requester: "" });
    });
  });

  test("uses the API for a ticket and leaves the page alone when it has everything", async () => {
    const { adapter: a, calls } = loadAdapter({
      invoke: () => ({ subject: "VPN drops", requester: "Dana Reyes", requesterFirstName: "Dana" }),
    });
    const webview = pageWebview({ subject: "page subject", requester: "page requester" });
    expect(await a.reply.readContext(Object.assign({ webview }, TICKET)))
      .toEqual({ subject: "VPN drops", requester: "Dana Reyes", requesterFirstName: "Dana" });
    expect(calls).toEqual([["freshservice", "get-ticket-fields", { ticketId: "5", host: "acme.freshservice.com" }]]);
    expect(webview.executeJavaScript).not.toHaveBeenCalled();
  });

  test("fills what the API didn't give from the page", async () => {
    const { adapter: a } = loadAdapter({ invoke: () => ({ subject: "VPN drops" }) });
    const webview = pageWebview({ subject: "page subject", requester: "Dana Reyes" });
    expect(await a.reply.readContext(Object.assign({ webview }, TICKET)))
      .toEqual({ subject: "VPN drops", requester: "Dana Reyes" });
  });

  test("an API error or a thrown call falls back to the page", async () => {
    const webview = pageWebview({ subject: "page subject", requester: "Dana Reyes" });
    const failing = [() => ({ error: "rate limit", subject: "should be ignored" }), () => { throw new Error("offline"); }];
    for (const invoke of failing) {
      const { adapter: a } = loadAdapter({ invoke });
      expect(await a.reply.readContext(Object.assign({ webview }, TICKET)))
        .toEqual({ subject: "page subject", requester: "Dana Reyes" });
    }
  });

  test("changes and pages without a record skip the API", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: () => ({ subject: "nope" }) });
    const webview = pageWebview({ subject: "Change 5", requester: "" });
    expect(await a.reply.readContext({ webview, url: TICKET.url, record: { kind: "change", id: "5" } })).toEqual({ subject: "Change 5" });
    expect(await a.reply.readContext({ webview, url: TICKET.url, record: null })).toEqual({ subject: "Change 5" });
    expect(calls).toEqual([]);
  });

  test("a page that can't be read gives an empty context, not an error", async () => {
    const { adapter: a } = loadAdapter({ invoke: () => ({ skipped: true, error: "off" }) });
    const webview = { executeJavaScript: jest.fn(async () => { throw new Error("tab closed"); }) };
    expect(await a.reply.readContext(Object.assign({ webview }, TICKET))).toEqual({});
    expect(await a.reply.readContext(undefined)).toEqual({});
  });
});

describe("freshservice time entry", () => {
  test("says so when no record is open, without calling the API", async () => {
    const { adapter: a, calls } = loadAdapter();
    expect(await a.timeEntry.log({ url: "https://acme.freshservice.com/a/tickets", record: null, minutes: 30 }))
      .toEqual({ error: "Open a ticket to log time on." });
    expect(await a.timeEntry.log(undefined)).toEqual({ error: "Open a ticket to log time on." });
    expect(calls).toEqual([]);
  });

  test("passes the record, time, note and page host to the API handler", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: () => ({ ok: true, timeSpent: "01:05" }) });
    const res = await a.timeEntry.log({
      url: "https://acme.freshservice.com/a/changes/45",
      record: { ticket: "CHN-45", kind: "change", id: "45", label: "change #45" },
      minutes: 65, note: "Patched", billable: false,
    });
    expect(calls).toEqual([["freshservice", "add-time-entry",
      { kind: "change", id: "45", minutes: 65, note: "Patched", billable: false, host: "acme.freshservice.com" }]]);
    expect(res).toEqual({ ok: true, message: "Added a 01:05 time entry to change #45 in Freshservice." });
  });

  test("a record with no kind is logged as a ticket", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: () => ({ ok: true, timeSpent: "00:30" }) });
    const res = await a.timeEntry.log({ url: "not a url", record: { id: "7" }, minutes: 30 });
    expect(calls[0][2]).toMatchObject({ kind: "ticket", id: "7", host: "" });
    expect(res.message).toBe("Added a 00:30 time entry to the ticket in Freshservice.");
  });

  test("reports the API's error, or a plain one when there is no answer", async () => {
    const withError = loadAdapter({ invoke: () => ({ error: "This API key's agent isn't allowed to add time entries to that record (403)." }) });
    expect(await withError.adapter.timeEntry.log({ url: "https://a.freshservice.com/", record: { id: "7" }, minutes: 5 }))
      .toEqual({ error: "This API key's agent isn't allowed to add time entries to that record (403)." });
    const empty = loadAdapter({ invoke: () => null });
    expect(await empty.adapter.timeEntry.log({ url: "https://a.freshservice.com/", record: { id: "7" }, minutes: 5 }))
      .toEqual({ error: "Freshservice didn't save the time entry." });
  });
});

describe("freshservice ticket search", () => {
  const FOUND = {
    domain: "acme.freshservice.com",
    tickets: [
      { id: 42, subject: "VPN drops", requester: "Dana Reyes", requesterEmail: "dana@acme.test", statusLabel: "Open", priorityLabel: "High", updatedAt: "2026-11-10T10:00:00Z", matches: ["subject"] },
      { id: 7 },
    ],
  };

  test("passes the term and day range, and shapes each ticket for the panel", async () => {
    const { adapter: a, calls } = loadAdapter({
      invoke: () => FOUND,
      tabs: [{ url: "https://acme.freshservice.com/a/tickets?filter=open", active: true }],
    });
    const res = await a.ticketSearch.search("vpn", { days: 30 });
    expect(calls).toEqual([["freshservice", "search-tickets", { term: "vpn", days: 30 }]]);
    expect(res.tickets).toEqual([
      {
        id: "42", label: "#42", subject: "VPN drops", requester: "Dana Reyes", requesterEmail: "dana@acme.test",
        status: "Open", priority: "High", updatedAt: "2026-11-10T10:00:00Z", matches: ["subject"],
        url: "https://acme.freshservice.com/a/tickets/42",
      },
      {
        id: "7", label: "#7", subject: "", requester: "", requesterEmail: "", status: "", priority: "", updatedAt: "", matches: [],
        url: "https://acme.freshservice.com/a/tickets/7",
      },
    ]);
    expect(res.note).toBe("");
    expect(res.warnings).toEqual([]);
  });

  test("links open on the active Freshservice tab's instance and portal", async () => {
    const { adapter: a } = loadAdapter({
      invoke: () => FOUND,
      tabs: [
        { url: "https://other.freshservice.com/a/tickets/1", active: false },
        { url: "https://na.myconnectwise.net/", active: false },
        { url: "https://acme.freshservice.com/helpdesk/tickets/3", active: true },
      ],
    });
    const res = await a.ticketSearch.search("vpn");
    expect(res.tickets.map((t) => t.url)).toEqual([
      "https://acme.freshservice.com/helpdesk/tickets/42",
      "https://acme.freshservice.com/helpdesk/tickets/7",
    ]);
  });

  test("with no Freshservice tab or Home URL, links use the API domain from the result", async () => {
    const noTabs = loadAdapter({ invoke: () => FOUND });
    expect((await noTabs.adapter.ticketSearch.search("vpn")).tickets[0].url).toBe("https://acme.freshservice.com/a/tickets/42");
    const otherTabs = loadAdapter({ invoke: () => FOUND, tabs: [{ url: "https://example.com/", active: true }] });
    expect((await otherTabs.adapter.ticketSearch.search("vpn")).tickets[0].url).toBe("https://acme.freshservice.com/a/tickets/42");
  });

  test("says how far back subjects were matched", async () => {
    const part = loadAdapter({ invoke: () => Object.assign({ scanned: 120, scanFull: false, days: 30, warnings: ["Requester search failed."] }, FOUND) });
    const res = await part.adapter.ticketSearch.search("vpn");
    expect(res.note).toBe("Subjects are matched against the 120 tickets updated in the last 30 days.");
    expect(res.warnings).toEqual(["Requester search failed."]);
    const full = loadAdapter({ invoke: () => Object.assign({ scanned: 500, scanFull: true, days: 90 }, FOUND) });
    expect((await full.adapter.ticketSearch.search("vpn")).note)
      .toBe("Subjects are matched against the 500 most recent tickets updated in the last 90 days.");
  });

  test("passes on errors and whether the API was simply not set up", async () => {
    const skipped = loadAdapter({ invoke: () => ({ skipped: true, error: "Enter your Freshservice API key in Settings → Freshservice." }) });
    expect(await skipped.adapter.ticketSearch.search("vpn"))
      .toEqual({ error: "Enter your Freshservice API key in Settings → Freshservice.", skipped: true });
    const failed = loadAdapter({ invoke: () => ({ error: "Freshservice API error 500." }) });
    expect(await failed.adapter.ticketSearch.search("vpn")).toEqual({ error: "Freshservice API error 500.", skipped: false });
    const silent = loadAdapter({ invoke: () => null });
    expect(await silent.adapter.ticketSearch.search("vpn")).toEqual({ error: "Freshservice didn't answer the search.", skipped: false });
  });
});

describe("freshservice quick actions", () => {
  const URL_5 = "https://acme.freshservice.com/a/tickets/5";

  test("reads and changes a ticket through the API handlers", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: (action) => ({ action }) });
    const ctx = { url: URL_5, record: { kind: "ticket", id: 5 } };
    expect(await a.ticketActions.get(ctx)).toEqual({ action: "get-ticket-state" });
    expect(await a.ticketActions.update(ctx, { status: 4 })).toEqual({ action: "update-ticket" });
    expect(calls).toEqual([
      ["freshservice", "get-ticket-state", { ticketId: "5", host: "acme.freshservice.com" }],
      ["freshservice", "update-ticket", { ticketId: "5", host: "acme.freshservice.com", changes: { status: 4 } }],
    ]);
  });

  test("changes, problems, releases and odd IDs never reach the API", async () => {
    const { adapter: a, calls } = loadAdapter();
    const refused = [
      { url: URL_5, record: { kind: "change", id: "5" } },
      { url: URL_5, record: { kind: "ticket", id: "5/../../agents" } },
      { url: URL_5, record: { kind: "ticket", id: "" } },
      { url: URL_5, record: { kind: "ticket", id: "1234567890123" } },
      { url: URL_5, record: null },
      undefined,
    ];
    for (const ctx of refused) {
      expect(await a.ticketActions.get(ctx)).toEqual({ error: "Quick actions work on Freshservice tickets only.", unsupported: true });
      expect(await a.ticketActions.update(ctx, { status: 4 })).toEqual({ error: "Quick actions work on Freshservice tickets only." });
    }
    expect(calls).toEqual([]);
  });

  test("a page URL that can't be parsed sends an empty host", async () => {
    const { adapter: a, calls } = loadAdapter();
    await a.ticketActions.get({ url: "about:blank#x y", record: { kind: "ticket", id: "5" } });
    await a.ticketActions.get({ url: "", record: { kind: "ticket", id: "5" } });
    expect(calls.map((c) => c[2].host)).toEqual(["", ""]);
  });

  test("options can be re-read on request", async () => {
    const { adapter: a, calls } = loadAdapter();
    await a.ticketActions.options();
    await a.ticketActions.options({ force: 1 });
    expect(calls).toEqual([
      ["freshservice", "get-ticket-options", { force: false }],
      ["freshservice", "get-ticket-options", { force: true }],
    ]);
  });
});

describe("freshservice ticket preview", () => {
  test("supports ticket numbers only", () => {
    const { supports } = adapter.ticketPreview;
    expect(supports({ id: "123" })).toBe(true);
    expect(supports({ key: "#0042" })).toBe(true);
    expect(supports({ id: 7, kind: "ticket" })).toBe(true);
    expect(supports({ key: "CHN-45" })).toBe(false);
    expect(supports({ key: "CW-123" })).toBe(false);
    expect(supports({ id: "45", kind: "change" })).toBe(false);
    expect(supports({ id: "1234567890123" })).toBe(false);
    expect(supports({})).toBe(false);
    expect(supports(null)).toBe(false);
  });

  test("asks the API for the ticket on the link's host and labels the result", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: () => ({ preview: { subject: "VPN drops", status: "Open" } }) });
    expect(await a.ticketPreview.preview({ key: "#0042", url: "https://acme.freshservice.com/a/tickets/42" }))
      .toEqual({ preview: { subject: "VPN drops", status: "Open", label: "#42" } });
    await a.ticketPreview.preview({ id: "42" });
    await a.ticketPreview.preview({ id: "42", url: "::bad::" });
    expect(calls).toEqual([
      ["freshservice", "preview-ticket", { ticketId: "42", host: "acme.freshservice.com" }],
      ["freshservice", "preview-ticket", { ticketId: "42", host: "" }],
      ["freshservice", "preview-ticket", { ticketId: "42", host: "" }],
    ]);
  });

  test("other records are skipped without a call, and errors are passed on", async () => {
    const none = loadAdapter();
    expect(await none.adapter.ticketPreview.preview({ key: "PRB-9" })).toEqual({ skipped: true, error: "Only tickets can be previewed." });
    expect(none.calls).toEqual([]);

    const skipped = loadAdapter({ invoke: () => ({ skipped: true, error: "The open page isn't the configured Freshservice domain." }) });
    expect(await skipped.adapter.ticketPreview.preview({ id: "1" }))
      .toEqual({ error: "The open page isn't the configured Freshservice domain.", skipped: true });
    const empty = loadAdapter({ invoke: () => ({}) });
    expect(await empty.adapter.ticketPreview.preview({ id: "1" })).toEqual({ error: "Freshservice didn't send the ticket.", skipped: false });
  });
});

describe("freshservice Solutions and alias host", () => {
  test("Solutions search and article reads go to the API handlers", async () => {
    const { adapter: a, calls } = loadAdapter({ invoke: (action) => ({ action }) });
    expect(await a.knowledge.search("vpn setup")).toEqual({ action: "search-solutions" });
    expect(await a.knowledge.getArticle(12)).toEqual({ action: "get-solution-article" });
    expect(calls).toEqual([
      ["freshservice", "search-solutions", { term: "vpn setup" }],
      ["freshservice", "get-solution-article", { id: 12 }],
    ]);
  });

  test("the alias host counts as Freshservice only while it has a target", () => {
    const set = loadAdapter({ settings: { fsAliasHost: "Service.Acme.com", fsAliasTarget: "acme.freshservice.com" } });
    expect(set.adapter.matchesUrl("https://service.acme.com/a/tickets/1")).toBe(true);
    expect(set.adapter.matchesUrl("https://sub.service.acme.com/")).toBe(false);
    expect(set.adapter.matchesUrl("https://service.acme.com.evil.net/")).toBe(false);
    set.listeners["settings:changed"]({ fsAliasHost: "service.acme.com", fsAliasTarget: "" });
    expect(set.adapter.matchesUrl("https://service.acme.com/a/tickets/1")).toBe(false);
  });

  test("an alias or API domain typed as a URL or with a port is not used as a host", () => {
    const { adapter: a } = loadAdapter({
      settings: { fsAliasHost: "https://service.acme.com", fsAliasTarget: "acme.freshservice.com", fsApiDomain: "help.acme.com:8443" },
    });
    expect(a.matchesUrl("https://service.acme.com/")).toBe(false);
    expect(a.matchesUrl("https://help.acme.com:8443/")).toBe(false);
  });

  test("quick-open works from a tab on the alias host", () => {
    const { adapter: a } = loadAdapter({ settings: { fsAliasHost: "service.acme.com", fsAliasTarget: "acme.freshservice.com" } });
    expect(a.ticketUrl("INC-12", { tabUrls: ["https://service.acme.com/a/tickets/1"] })).toBe("https://service.acme.com/a/tickets/12");
  });
});
