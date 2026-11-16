"use strict";

// Freshservice API handlers (plugins/freshservice/main.js) when things go wrong:
// timeouts, network errors, each HTTP status Freshservice sends, odd replies,
// IDs that would change the request path, and pages on another account.
// test/freshservice.test.js covers the working paths.

const fsApi = require("../plugins/freshservice/main");

// Placeholder only — never a real key.
const FAKE_KEY = "test-key-not-real";

let handlers;
let settings;
let logs;
let realFetch;

function initPlugin() {
  handlers = {};
  logs = [];
  fsApi.init({
    handle: (name, fn) => { handlers[name] = fn; },
    getSettings: () => settings,
    encryptCredential: (v) => "enc:" + v,
    decryptCredential: (v) => v.replace(/^enc:/, ""),
    registerSettingsTransformer: () => {},
    log: (...args) => logs.push(args.join(" ")),
  });
}

function response(status, body, headers) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (headers || {})[name.toLowerCase()] || null },
    json: async () => { if (body instanceof Error) throw body; return body; },
  };
}

beforeEach(() => {
  realFetch = global.fetch;
  settings = { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY };
  initPlugin();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("freshservice API transport errors", () => {
  test("a request that times out says how long it waited", async () => {
    global.fetch = jest.fn(async () => { const e = new Error("The operation timed out."); e.name = "TimeoutError"; throw e; });
    expect(await handlers["get-ticket"]({ ticketId: "7" })).toEqual({ error: "Freshservice did not respond within 15 seconds" });
    global.fetch = jest.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    expect((await handlers["test-connection"]()).error).toBe("Freshservice did not respond within 15 seconds");
  });

  test("a network failure is reported as unreachable, with the cause", async () => {
    global.fetch = jest.fn(async () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND"); });
    expect(await handlers["test-connection"]()).toEqual({ error: "Could not reach Freshservice: fetch failed: getaddrinfo ENOTFOUND" });
    global.fetch = jest.fn(async () => { throw "socket hang up"; });
    expect((await handlers["get-ticket-fields"]({ ticketId: "7" })).error).toBe("Could not reach Freshservice: socket hang up");
  });

  test("every request has a timeout signal and never puts the key in the URL", async () => {
    global.fetch = jest.fn(async () => response(200, { tickets: [] }));
    await handlers["test-connection"]();
    const [url, init] = global.fetch.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(url).not.toContain(FAKE_KEY);
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from(FAKE_KEY + ":X").toString("base64"));
  });
});

describe("freshservice API status messages", () => {
  const cases = [
    [400, "get-ticket", "Freshservice rejected the request (400)."],
    [401, "get-ticket", "Freshservice rejected the API key (401). Check it in Settings → Freshservice."],
    [403, "get-ticket", "This API key isn't allowed to view that ticket (403)."],
    [403, "get-solution-article", "This API key isn't allowed to view that solution article (403)."],
    [404, "get-ticket", "Ticket not found in Freshservice (404)."],
    [429, "get-ticket", "Freshservice API rate limit reached (429)."],
    [500, "get-ticket", "Freshservice API error 500."],
    [503, "test-connection", "Freshservice API error 503."],
  ];
  const requests = {
    "get-ticket": { ticketId: "7" },
    "get-solution-article": { id: 12 },
    "test-connection": undefined,
  };

  test.each(cases)("%i from %s", async (status, handler, message) => {
    global.fetch = jest.fn(async () => response(status, {}));
    const res = await handlers[handler](requests[handler]);
    expect(res.error).toContain(message);
    expect(res.error).not.toContain(FAKE_KEY);
  });

  test("a rate limit says when to retry when Freshservice gives a time", async () => {
    global.fetch = jest.fn(async () => response(429, {}, { "retry-after": "30" }));
    expect((await handlers["get-ticket"]({ ticketId: "7" })).error).toBe("Freshservice API rate limit reached (429), retry in 30 seconds.");
  });

  test("a rejected time entry lists Freshservice's field errors, three at most", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith("/agents/me")) return response(200, { agent: { id: 5 } });
      return response(400, {
        errors: [
          { field: "agent_id", message: "It should be a/an Integer" },
          { message: "Time spent is invalid" },
          { field: "note" },
          { field: "billable", message: "never shown" },
        ],
      });
    });
    const res = await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 });
    expect(res.error).toBe("Freshservice didn't accept the time entry (400). (agent_id: It should be a/an Integer; Time spent is invalid; note)");
  });

  test("a 400 without a readable body still gives the plain message", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith("/agents/me")) return response(200, { agent: { id: 5 } });
      return response(400, new SyntaxError("Unexpected token <"));
    });
    expect((await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 })).error)
      .toBe("Freshservice didn't accept the time entry (400).");
  });

  test("time entry and ticket update permissions have their own 403 messages", async () => {
    global.fetch = jest.fn(async (url) => (url.endsWith("/agents/me") ? response(200, { agent: { id: 5 } }) : response(403, {})));
    expect((await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 })).error)
      .toBe("This API key's agent isn't allowed to add time entries to that record (403).");
    expect((await handlers["update-ticket"]({ ticketId: "42", changes: { status: 4 } })).error)
      .toBe("This API key's agent isn't allowed to change that ticket (403).");
  });

  test("errors are logged without the key", async () => {
    global.fetch = jest.fn(async () => response(500, {}));
    await handlers["get-ticket"]({ ticketId: "7" });
    expect(logs.join("\n")).toMatch(/get-ticket failed: Freshservice API error 500/);
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
  });
});

describe("freshservice API odd replies", () => {
  test("a time entry is refused when Freshservice won't say who the key belongs to, and not cached", async () => {
    let me = { agent: { id: "not-a-number" } };
    global.fetch = jest.fn(async (url) => (url.endsWith("/agents/me") ? response(200, me) : response(201, { time_entry: { id: 1, time_spent: "00:05" } })));
    expect((await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 })).error)
      .toBe("Freshservice didn't say which agent the API key belongs to.");
    me = {};
    expect((await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 })).error)
      .toBe("Freshservice didn't say which agent the API key belongs to.");
    me = { agent: { id: "21000418005" } };
    expect(await handlers["add-time-entry"]({ kind: "ticket", id: "42", minutes: 5 })).toMatchObject({ ok: true });
    expect(global.fetch.mock.calls.filter((c) => c[0].endsWith("/agents/me"))).toHaveLength(3);
  });

  test("a ticket reply missing its fields gives empty text, not a crash", async () => {
    global.fetch = jest.fn(async () => response(200, {}));
    const fields = await handlers["get-ticket-fields"]({ ticketId: "7" });
    expect(fields).toEqual({ ticketId: "7", subject: "", requester: "", requesterFirstName: "" });
    const state = await handlers["get-ticket-state"]({ ticketId: "7" });
    expect(state).toEqual({ error: "Freshservice returned no ticket." });
  });

  test("get-ticket-fields tidies the requester's name and works out the first name", async () => {
    const replies = [
      [{ subject: "  VPN\n drops ", requester: { name: "Dana   Reyes", first_name: "Dana" } }, { subject: "VPN drops", requester: "Dana Reyes", requesterFirstName: "Dana" }],
      [{ subject: "x", requester: { first_name: "Sam", last_name: "Lee" } }, { subject: "x", requester: "Sam Lee", requesterFirstName: "Sam" }],
      [{ subject: "x", requester: { name: "Pat Kim" } }, { subject: "x", requester: "Pat Kim", requesterFirstName: "Pat" }],
      [{ subject: 5, requester: "not an object" }, { subject: "", requester: "", requesterFirstName: "" }],
    ];
    for (const [ticket, expected] of replies) {
      global.fetch = jest.fn(async () => response(200, { ticket }));
      expect(await handlers["get-ticket-fields"]({ ticketId: "7" })).toEqual(Object.assign({ ticketId: "7" }, expected));
    }
  });

  test("a deleted ticket's preview says so", async () => {
    global.fetch = jest.fn(async () => response(404, {}));
    expect(await handlers["preview-ticket"]({ ticketId: "7" })).toEqual({ error: "Ticket #7 wasn't found (it may have been deleted)." });
  });

  test("a preview still shows when the agent or note author can't be looked up", async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.includes("/conversations")) return response(200, { conversations: [{ id: 1, body_text: "Rebooted", incoming: false, user_id: 9, created_at: "2026-11-16T09:00:00Z" }] });
      if (url.includes("/tickets/7")) return response(200, { ticket: { id: 7, subject: "VPN", status: 2, priority: 1, responder_id: 8 } });
      return response(500, {});
    });
    const res = await handlers["preview-ticket"]({ ticketId: "7" });
    expect(res.error).toBeUndefined();
    expect(res.preview).toBeDefined();
  });
});

describe("freshservice API request checks", () => {
  test("IDs that aren't plain numbers never reach the API", async () => {
    global.fetch = jest.fn(async () => response(200, {}));
    const bad = ["7/../../agents", "7?x=1", "CHN-4", "", "1234567890123", " 7", null];
    for (const ticketId of bad) {
      expect((await handlers["get-ticket"]({ ticketId })).skipped).toBe(true);
      expect((await handlers["get-ticket-fields"]({ ticketId })).skipped).toBe(true);
      expect((await handlers["get-ticket-state"]({ ticketId })).skipped).toBe(true);
      expect((await handlers["preview-ticket"]({ ticketId })).skipped).toBe(true);
      expect((await handlers["update-ticket"]({ ticketId, changes: { status: 4 } })).error).toBe("Quick actions work on tickets only.");
    }
    expect(await handlers["get-ticket"](undefined)).toMatchObject({ skipped: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("pages on another account are refused before any request", async () => {
    global.fetch = jest.fn(async () => response(200, {}));
    const host = "other.freshservice.com";
    expect(await handlers["get-ticket"]({ ticketId: "7", host })).toEqual({ skipped: true, error: "The open page (other.freshservice.com) isn't the configured Freshservice domain." });
    expect((await handlers["get-ticket-fields"]({ ticketId: "7", host })).skipped).toBe(true);
    expect((await handlers["get-ticket-state"]({ ticketId: "7", host })).skipped).toBe(true);
    expect((await handlers["update-ticket"]({ ticketId: "7", host, changes: { status: 4 } })).skipped).toBe(true);
    expect(await handlers["preview-ticket"]({ ticketId: "7", host: "Other.Freshservice.com" }))
      .toEqual({ skipped: true, error: "This ticket is on other.freshservice.com, not the configured Freshservice domain (acme.freshservice.com)." });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("the host check ignores letter case", async () => {
    global.fetch = jest.fn(async () => response(200, { ticket: { id: 7, subject: "x" } }));
    expect((await handlers["get-ticket-fields"]({ ticketId: "7", host: "ACME.Freshservice.com" })).skipped).toBeUndefined();
  });

  test("a page on the alias host is the same account for every handler", async () => {
    settings = Object.assign({}, settings, { fsAliasHost: "service.acme.com", fsAliasTarget: "acme.freshservice.com" });
    global.fetch = jest.fn(async () => response(200, { ticket: { id: 7, subject: "x" }, conversations: [] }));
    const host = "service.acme.com";
    expect((await handlers["get-ticket"]({ ticketId: "7", host })).skipped).toBeUndefined();
    expect((await handlers["get-ticket-state"]({ ticketId: "7", host })).skipped).toBeUndefined();
    expect((await handlers["preview-ticket"]({ ticketId: "7", host })).skipped).toBeUndefined();
    // Requests still go to the configured API domain.
    expect(global.fetch.mock.calls.every((c) => c[0].startsWith("https://acme.freshservice.com/api/v2/"))).toBe(true);
  });

  test("the API switched off or not set up skips every handler without a request", async () => {
    global.fetch = jest.fn();
    for (const s of [
      { fsApiEnabled: false, fsApiDomain: "acme.freshservice.com", fsApiKeyEncrypted: "enc:" + FAKE_KEY },
      { fsApiEnabled: true, fsApiDomain: "", fsApiKeyEncrypted: "enc:" + FAKE_KEY },
      { fsApiEnabled: true, fsApiDomain: "acme.freshservice.com" },
    ]) {
      settings = s;
      for (const [name, data] of [["get-ticket", { ticketId: "7" }], ["get-ticket-state", { ticketId: "7" }], ["search-tickets", { term: "vpn" }], ["get-ticket-options", {}], ["count-tickets", { query: "status:2" }]]) {
        const res = await handlers[name](data);
        expect(res.error).toBeTruthy();
      }
      expect((await handlers["test-connection"]()).error).toBeTruthy();
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("freshservice ticket update checks", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => response(200, { ticket: { id: 42 } }));
  });

  test.each([
    [{ status: 0 }, "That isn't a status Freshservice knows."],
    [{ status: "2" }, "That isn't a status Freshservice knows."],
    [{ status: 2.5 }, "That isn't a status Freshservice knows."],
    [{ priority: 100001 }, "That isn't a priority Freshservice knows."],
    [{ agentId: "bob" }, "That isn't an agent Freshservice knows."],
    [{ groupId: -1 }, "That isn't a group Freshservice knows."],
    [{}, "Nothing to change."],
    [{ unknown: 1 }, "Nothing to change."],
  ])("%j is refused before any request", async (changes, error) => {
    expect(await handlers["update-ticket"]({ ticketId: "42", changes })).toEqual({ error });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("null unassigns the agent and group", async () => {
    const res = await handlers["update-ticket"]({ ticketId: "42", changes: { agentId: null, groupId: null } });
    expect(res.ok).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ responder_id: null, group_id: null });
  });

  test("assigning to me fails cleanly when the key's agent can't be found", async () => {
    global.fetch = jest.fn(async () => response(401, {}));
    expect((await handlers["update-ticket"]({ ticketId: "42", changes: { agentId: "me" } })).error)
      .toBe("Freshservice rejected the API key (401). Check it in Settings → Freshservice.");
    expect(global.fetch.mock.calls.map((c) => c[1].method || "GET")).toEqual(["GET"]);
  });
});
