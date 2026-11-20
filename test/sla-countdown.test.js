"use strict";

const fs = require("fs");
const path = require("path");
const sla = require("../plugins/sla-countdown/renderer");
const slaMain = require("../plugins/sla-countdown/main");
const fsApi = require("../plugins/freshservice/main");

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";
const MIN = 60 * 1000;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const at = (minutes) => new Date(NOW + minutes * MIN).toISOString();

describe("sla-countdown helpers", () => {
  test("readSettings fills defaults and keeps red at or below amber", () => {
    expect(sla.readSettings({})).toEqual({ badges: true, notify: true, amber: 60, red: 15, refresh: 5 });
    expect(sla.readSettings({ slaAmberMinutes: 10, slaRedMinutes: 30 })).toMatchObject({ amber: 10, red: 10 });
    expect(sla.readSettings({ slaTabBadges: false, slaRefreshMinutes: 999 })).toMatchObject({ badges: false, refresh: 5 });
  });

  test("counts down to the first response until it's sent, then resolution", () => {
    const t = { state: "running", frDueBy: at(30), dueBy: at(240), responded: false };
    expect(sla.nextDeadline(t, NOW)).toMatchObject({ kind: "response", left: 30 * MIN });
    expect(sla.nextDeadline(Object.assign({}, t, { responded: true }), NOW)).toMatchObject({ kind: "resolution", left: 240 * MIN });
    // Missed response stays the deadline (negative left).
    expect(sla.nextDeadline(Object.assign({}, t, { frDueBy: at(-5) }), NOW)).toMatchObject({ kind: "response", left: -5 * MIN });
  });

  test("unknown first response counts while ahead or escalated", () => {
    const t = { state: "running", frDueBy: at(30), dueBy: at(240), responded: null };
    expect(sla.nextDeadline(t, NOW).kind).toBe("response");
    expect(sla.nextDeadline(Object.assign({}, t, { frDueBy: at(-30) }), NOW).kind).toBe("resolution");
    expect(sla.nextDeadline(Object.assign({}, t, { frDueBy: at(-30), frEscalated: true }), NOW).kind).toBe("response");
  });

  test("an earlier resolution due time wins", () => {
    const t = { state: "running", frDueBy: at(60), dueBy: at(20), responded: false };
    expect(sla.nextDeadline(t, NOW).kind).toBe("resolution");
  });

  test("done, paused and no due time", () => {
    expect(sla.nextDeadline({ state: "done", dueBy: at(5) }, NOW)).toEqual({ state: "done" });
    expect(sla.nextDeadline({ state: "paused", dueBy: at(5) }, NOW)).toEqual({ state: "paused" });
    expect(sla.nextDeadline({ state: "running" }, NOW)).toBeNull();
    expect(sla.nextDeadline(null, NOW)).toBeNull();
  });

  test("urgency thresholds", () => {
    expect(sla.urgency(90 * MIN, 60, 15)).toBe("ok");
    expect(sla.urgency(60 * MIN, 60, 15)).toBe("amber");
    expect(sla.urgency(15 * MIN, 60, 15)).toBe("red");
    expect(sla.urgency(0, 60, 15)).toBe("red");
    expect(sla.urgency(-1, 60, 15)).toBe("overdue");
  });

  test("formatSpan and badgeText", () => {
    expect(sla.formatSpan(30 * 1000)).toBe("<1m");
    expect(sla.formatSpan(45 * MIN + 59 * 1000)).toBe("45m");
    expect(sla.formatSpan(125 * MIN)).toBe("2h 05m");
    expect(sla.formatSpan((3 * 24 + 4) * 60 * MIN)).toBe("3d 4h");
    expect(sla.badgeText({ state: "running", left: -12 * MIN })).toBe("−12m");
    expect(sla.badgeText({ state: "paused" })).toBe("");
  });

  test("describeDeadline", () => {
    expect(sla.describeDeadline({ state: "running", kind: "response", due: NOW + 45 * MIN, left: 45 * MIN }, NOW))
      .toMatch(/^First response due in 45m \(/);
    expect(sla.describeDeadline({ state: "running", kind: "resolution", due: NOW - 125 * MIN, left: -125 * MIN }, NOW))
      .toMatch(/^Resolution overdue by 2h 05m \(/);
    expect(sla.describeDeadline({ state: "paused" }, NOW)).toMatch(/On hold/);
    expect(sla.describeDeadline(null, NOW)).toBe("No SLA due time");
  });

  test("sortByDeadline: overdue first, then no due time, then on hold; done dropped", () => {
    const list = [
      { id: 1, state: "running", dueBy: at(120), responded: true },
      { id: 2, state: "paused", dueBy: at(10) },
      { id: 3, state: "running", dueBy: at(-10), responded: true },
      { id: 4, state: "running" },
      { id: 5, state: "done", dueBy: at(1) },
      { id: 6, state: "running", frDueBy: at(5), dueBy: at(500), responded: false },
    ];
    expect(sla.sortByDeadline(list, NOW).map((x) => x.ticket.id)).toEqual([3, 6, 1, 4, 2]);
  });

  test("alertKey only for red or overdue", () => {
    const s = { amber: 60, red: 15 };
    const t = { id: 7 };
    expect(sla.alertKey("freshservice", t, { state: "running", kind: "response", left: 30 * MIN }, s)).toBe("");
    expect(sla.alertKey("freshservice", t, { state: "running", kind: "response", left: 10 * MIN }, s)).toBe("freshservice|7|response|red");
    expect(sla.alertKey("freshservice", t, { state: "running", kind: "resolution", left: -1 }, s)).toBe("freshservice|7|resolution|overdue");
    expect(sla.alertKey("freshservice", t, { state: "paused" }, s)).toBe("");
  });

  test("main validates its settings", () => {
    const v = slaMain.validateSettings;
    expect(v(slaMain.defaultSettings)).toBe(true);
    expect(v({ slaTabBadges: "yes" })).toBe(false);
    expect(v({ slaAmberMinutes: 0 })).toBe(false);
    expect(v({ slaRedMinutes: 1.5 })).toBe(false);
    expect(v({ slaRefreshMinutes: 61 })).toBe(false);
    expect(v({ slaRefreshMinutes: 10 })).toBe(true);
  });
});

describe("freshservice formatTicketSla", () => {
  const labels = fsApi.choicesToLabels({ status: [{ value: 2, label: "Open" }, { value: 3, label: "Pending" }, { value: 7, label: "Awaiting Vendor" }, { value: 8, label: "In Progress" }] });

  test("maps the due times, escalation flags and first response", () => {
    const out = fsApi.formatTicketSla({
      id: 42, subject: "VPN", status: 2, priority: 3, fr_due_by: at(30), due_by: at(240),
      fr_escalated: false, is_escalated: true, updated_at: at(-1), stats: { first_responded_at: at(-60) },
    }, labels);
    expect(out).toMatchObject({
      id: 42, subject: "VPN", status: 2, statusLabel: "Open", priorityLabel: "High", state: "running",
      frDueBy: at(30), dueBy: at(240), frEscalated: false, isEscalated: true, responded: true, firstRespondedAt: at(-60),
    });
  });

  test("responded is null without stats and false with an empty one", () => {
    expect(fsApi.formatTicketSla({ id: 1, status: 2 }, labels).responded).toBeNull();
    expect(fsApi.formatTicketSla({ id: 1, status: 2, stats: { first_responded_at: null } }, labels).responded).toBe(false);
  });

  test("state from status: done, paused by number or name, else running", () => {
    expect(fsApi.formatTicketSla({ id: 1, status: 4 }, labels).state).toBe("done");
    expect(fsApi.formatTicketSla({ id: 1, status: 5 }, labels).state).toBe("done");
    expect(fsApi.formatTicketSla({ id: 1, status: 3 }, labels).state).toBe("paused");
    expect(fsApi.formatTicketSla({ id: 1, status: 7 }, labels).state).toBe("paused");
    expect(fsApi.formatTicketSla({ id: 1, status: 8 }, labels).state).toBe("running");
  });

  test("drops bad dates and bad tickets", () => {
    expect(fsApi.formatTicketSla({ id: 1, status: 2, due_by: "soon" }, labels).dueBy).toBe("");
    expect(fsApi.formatTicketSla({ subject: "no id" }, labels)).toBeNull();
    expect(fsApi.formatTicketSla(null, labels)).toBeNull();
  });
});

describe("freshservice SLA handlers", () => {
  let handlers;
  let realFetch;
  let settings;
  const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body });

  beforeEach(() => {
    realFetch = global.fetch;
    settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY };
    handlers = {};
    fsApi.init({
      handle: (name, fn) => { handlers[name] = fn; },
      on: () => {},
      getSettings: () => settings,
      encryptCredential: (v) => "enc:" + v,
      decryptCredential: (v) => v.replace(/^enc:/, ""),
      registerSettingsTransformer: () => {},
      log: () => {},
    });
  });
  afterEach(() => { global.fetch = realFetch; });

  test("ticket-sla reads the ticket with stats and checks the host, alias included", async () => {
    settings.fsAliasHost = "service.acme.com";
    settings.fsAliasTarget = "acme.freshservice.com";
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/ticket_form_fields")) return jsonResponse({});
      if (url.endsWith("/tickets/42?include=stats")) {
        return jsonResponse({ ticket: { id: 42, status: 2, fr_due_by: at(30), due_by: at(240), stats: { first_responded_at: null } } });
      }
      return jsonResponse({}, 404);
    });
    const res = await handlers["ticket-sla"]({ ticketId: "42", host: "service.acme.com" });
    expect(res.ticket).toMatchObject({ id: 42, state: "running", responded: false, frDueBy: at(30) });
    expect((await handlers["ticket-sla"]({ ticketId: "42", host: "other.freshservice.com" })).skipped).toBe(true);
    expect((await handlers["ticket-sla"]({ ticketId: "CHN-1" })).skipped).toBe(true);
    expect((await handlers["ticket-sla"]({ ticketId: "99" })).error).toMatch(/wasn't found/);
  });

  test("my-sla-tickets filters my open tickets by range and reads stats only where needed, cached", async () => {
    const tickets = [
      { id: 1, status: 2, fr_due_by: at(30), due_by: at(240), updated_at: at(-5) },
      { id: 2, status: 3, fr_due_by: at(10), due_by: at(100), updated_at: at(-5) },  // paused: no stats
      { id: 3, status: 2, due_by: at(60), updated_at: at(-5) },                      // no response due: no stats
    ];
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/agents/me")) return jsonResponse({ agent: { id: 9 } });
      if (url.includes("/ticket_form_fields")) return jsonResponse({});
      if (url.includes("/tickets/filter")) return jsonResponse({ tickets, total: 3 });
      if (url.endsWith("/tickets/1?include=stats")) {
        return jsonResponse({ ticket: Object.assign({}, tickets[0], { stats: { first_responded_at: at(-2) } }) });
      }
      return jsonResponse({}, 404);
    });
    const res = await handlers["my-sla-tickets"]({});
    expect(res.error).toBeUndefined();
    const filterUrl = global.fetch.mock.calls.map((c) => c[0]).find((u) => u.includes("/tickets/filter"));
    expect(decodeURIComponent(filterUrl)).toContain("\"agent_id:9 AND (status:2 OR status:3 OR status:>5)\"");
    expect(decodeURIComponent(filterUrl)).not.toMatch(/NOT/i);
    expect(res.tickets.map((t) => [t.id, t.state, t.responded])).toEqual([[1, "running", true], [2, "paused", null], [3, "running", null]]);
    expect(res.accountHosts).toEqual(["acme.freshservice.com"]);
    const statsCalls = () => global.fetch.mock.calls.filter((c) => c[0].includes("include=stats")).length;
    expect(statsCalls()).toBe(1);
    await handlers["my-sla-tickets"]({});
    expect(statsCalls()).toBe(1); // same updated_at → cached
  });

  test("my-sla-tickets names custom open statuses, never ranges that reach Resolved or Closed, and says when it stops short", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/agents/me")) return jsonResponse({ agent: { id: 9 } });
      if (url.includes("/ticket_form_fields")) {
        return jsonResponse({ ticket_fields: [{ name: "status", choices: [
          { id: 2, value: "Open" }, { id: 3, value: "Pending" }, { id: 4, value: "Resolved" },
          { id: 5, value: "Closed" }, { id: 6, value: "Awaiting Vendor" }, { id: 8, value: "In Progress" },
        ] }] });
      }
      if (url.includes("/tickets/filter")) {
        const page = Number(/page=(\d+)/.exec(url)[1]);
        const tickets = Array.from({ length: 30 }, (_, i) => ({ id: page * 100 + i, status: 2, due_by: at(60) }));
        return jsonResponse({ tickets, total: 200 });
      }
      return jsonResponse({}, 404);
    });
    const res = await handlers["my-sla-tickets"]({});
    const urls = global.fetch.mock.calls.map((c) => decodeURIComponent(c[0])).filter((u) => u.includes("/tickets/filter"));
    expect(urls[0]).toContain("\"agent_id:9 AND (status:2 OR status:3 OR status:6 OR status:8 OR status:>8)\"");
    expect(urls).toHaveLength(5);
    expect(res.tickets).toHaveLength(150);
    expect(res.warnings).toContain("Showing the first 150 of your 200 open tickets.");
  });

  test("slaOpenStatusQuery", () => {
    expect(fsApi.slaOpenStatusQuery(fsApi.choicesToLabels({}))).toBe("(status:2 OR status:3 OR status:>5)");
    expect(fsApi.slaOpenStatusQuery(fsApi.choicesToLabels({ status: [
      { value: 2, label: "Open" }, { value: 9, label: "Closed" }, { value: 7, label: "On Hold" },
    ] }))).toBe("(status:2 OR status:7 OR status:>9)");
    expect(fsApi.slaOpenStatusQuery(null)).toBe("(status:2 OR status:3 OR status:>5)");
  });

  test("my-sla-tickets passes on a missing API key", async () => {
    settings.fsApiKeyEncrypted = "";
    const res = await handlers["my-sla-tickets"]({});
    expect(res.skipped).toBe(true);
  });
});

describe("freshservice ticketSla adapter part", () => {
  const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/freshservice/renderer.js"), "utf-8");

  function loadAdapter(invoke, tabs) {
    let adapter = null;
    global.window = {
      pluginAPI: {
        sites: { register: (a) => { adapter = a; return a; }, list: () => (adapter ? [adapter] : []) },
        getSettings: () => ({ fsApiDomain: "acme.freshservice.com" }),
        events: { on: () => {} },
        browser: { getTabs: () => tabs || [] },
        invoke,
      },
    };
    try { new Function(SOURCE)(); } finally { delete global.window; }
    return adapter;
  }

  test("refForUrl finds ticket pages only", () => {
    const a = loadAdapter(async () => ({}));
    expect(a.ticketSla.refForUrl("https://acme.freshservice.com/a/tickets/0042?current_tab=details"))
      .toMatchObject({ id: "42", label: "#42", host: "acme.freshservice.com" });
    expect(a.ticketSla.refForUrl("https://acme.freshservice.com/a/changes/42")).toBeNull();
    expect(a.ticketSla.refForUrl("https://acme.freshservice.com/a/dashboard")).toBeNull();
    expect(a.ticketSla.refForUrl("https://example.com/a/tickets/42")).toBeNull();
    expect(a.ticketSla.refForUrl("not a url")).toBeNull();
  });

  test("get passes the host; listMine links tickets to an open tab of the account", async () => {
    const calls = [];
    const a = loadAdapter(async (id, action, data) => {
      calls.push([action, data]);
      if (action === "ticket-sla") return { ticket: { id: 42, state: "running" } };
      if (action === "my-sla-tickets") return { tickets: [{ id: 7 }], domain: "acme.freshservice.com", accountHosts: ["acme.freshservice.com"], warnings: ["w"] };
      return {};
    }, [{ url: "https://acme.freshservice.com/helpdesk/tickets/1", active: true }]);
    const got = await a.ticketSla.get({ id: "42", url: "https://acme.freshservice.com/a/tickets/42" });
    expect(got.ticket.label).toBe("#42");
    expect(calls[0]).toEqual(["ticket-sla", { ticketId: "42", host: "acme.freshservice.com" }]);
    const mine = await a.ticketSla.listMine();
    expect(mine.tickets[0]).toMatchObject({ id: 7, label: "#7", url: "https://acme.freshservice.com/helpdesk/tickets/7" });
    expect(mine.warnings).toEqual(["w"]);
  });

  test("errors pass through with skipped", async () => {
    const a = loadAdapter(async () => ({ error: "Enter your API key", skipped: true }));
    expect(await a.ticketSla.listMine()).toEqual({ error: "Enter your API key", skipped: true });
    expect(await a.ticketSla.get({ id: "x" })).toMatchObject({ skipped: true });
  });
});
