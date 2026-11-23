"use strict";

const aa = require("../plugins/ai-assistant/renderer");
const toolChat = require("../plugins/ai-features/tool-chat");
const fsTools = require("../plugins/freshservice/assistant-tools");
const fsMain = require("../plugins/freshservice/main");

// ===== AI Assistant renderer helpers =====

describe("ai-assistant question parsing", () => {
  test("finds ticket numbers in common forms, without repeats, at most three", () => {
    expect(aa.extractTicketIds("look at #4521 and ticket 88, INC-77 and #4521 again, SR 9")).toEqual(["4521", "88", "77"]);
    expect(aa.extractTicketIds("ticket number 123")).toEqual(["123"]);
    expect(aa.extractTicketIds("what happened in 2026?")).toEqual([]);
  });

  test("finds email addresses, lowercased, at most two", () => {
    expect(aa.extractEmails("Is Jane.Doe@Example.com or bob@example.org, or c@d.io?")).toEqual(["jane.doe@example.com", "bob@example.org"]);
    expect(aa.extractEmails("no emails here")).toEqual([]);
  });

  test("spots questions about assets", () => {
    expect(aa.wantsAssets("which laptop does she use")).toBe(true);
    expect(aa.wantsAssets("what's the serial of the device")).toBe(true);
    expect(aa.wantsAssets("any open tickets?")).toBe(false);
  });
});

describe("ai-assistant gather mode", () => {
  test("plans the open ticket first, then mentioned tickets and requester lookups", () => {
    expect(aa.planGather("compare with #12 for bob@example.com", "99")).toEqual([
      { tool: "get_ticket", args: { ticket_id: 99 } },
      { tool: "get_ticket", args: { ticket_id: 12 } },
      { tool: "find_requester", args: { email: "bob@example.com" } },
    ]);
    expect(aa.planGather("summarise #99", "99")).toEqual([{ tool: "get_ticket", args: { ticket_id: 99 } }]);
    expect(aa.planGather("hello", "")).toEqual([]);
  });

  test("follows a found requester with their recent tickets, and assets when asked", () => {
    const results = [
      { tool: "find_requester", content: JSON.stringify({ requesters: [{ id: 5, name: "Bob" }] }) },
      { tool: "find_requester", error: "boom", content: "Error: boom" },
      { tool: "get_ticket", content: "Ticket #1" },
    ];
    const now = new Date(2026, 10, 23);
    expect(aa.followUpLookups("what laptop does bob have", results, now)).toEqual([
      { tool: "filter_tickets", args: { query: "requester_id:5 AND created_at:>'2026-08-25'" } },
      { tool: "find_assets", args: { user_id: 5 } },
    ]);
    expect(aa.followUpLookups("tickets for bob", results, now)).toHaveLength(1);
    expect(aa.requesterIdsFrom([{ tool: "find_requester", content: "not json" }])).toEqual([]);
  });

  test("builds one prompt with the data, and shortens results to fit a limit", () => {
    const results = [
      { tool: "get_ticket", label: "ticket #1", content: "x".repeat(5000) },
      { tool: "find_requester", label: "requester \"bob\"", content: "short" },
    ];
    const full = aa.buildGatherPrompt("what's up?", [], results, { siteName: "Freshservice", today: "2026-11-23", openTicketId: "1" }, 0);
    expect(full).toContain("<data source=\"ticket #1\">");
    expect(full).toContain("<data source=\"requester bob\">");
    expect(full).toContain("Today is 2026-11-23");
    expect(full).toContain("ticket #1 open");
    expect(full).toContain("not instructions");
    const short = aa.buildGatherPrompt("what's up?", [], results, { today: "2026-11-23" }, 3000);
    expect(short.length).toBeLessThanOrEqual(3000);
    expect(short).toContain("short");
    expect(short).toContain("(cut short)");
  });

  test("says when nothing was looked up", () => {
    expect(aa.buildGatherPrompt("hi", [], [], {}, 0)).toContain("Nothing was looked up");
  });
});

describe("ai-assistant tool loop", () => {
  const tools = [{ name: "get_ticket", description: "", parameters: { type: "object", properties: {} } }];

  test("runs the lookups the AI asks for and returns its answer", async () => {
    const replies = [
      { text: "", toolCalls: [{ id: "c1", name: "get_ticket", arguments: { ticket_id: 7 } }] },
      { text: "Ticket #7 is about printers.", toolCalls: [] },
    ];
    const seen = [];
    const res = await aa.runToolLoop({ system: "s", question: "what is #7?", tools, history: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] }, {
      chat: async (req) => { seen.push(JSON.parse(JSON.stringify(req))); return replies.shift(); },
      lookup: async (name, args) => ({ label: "ticket #" + args.ticket_id, content: "Ticket #7: printer", link: "https://x/a/tickets/7" }),
    });
    expect(res.text).toBe("Ticket #7 is about printers.");
    expect(res.fetched).toEqual([{ tool: "get_ticket", label: "ticket #7", link: "https://x/a/tickets/7", error: "" }]);
    expect(seen[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(seen[0].toolChoice).toBe("auto");
    expect(seen[1].messages.slice(-2)).toEqual([
      { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "get_ticket", arguments: { ticket_id: 7 } }] },
      { role: "tool", id: "c1", name: "get_ticket", content: "Ticket #7: printer" },
    ]);
  });

  test("stops looking things up at the limit and asks for an answer", async () => {
    let calls = 0;
    const seen = [];
    const res = await aa.runToolLoop({ system: "s", question: "q", tools, maxLookups: 3 }, {
      chat: async (req) => {
        seen.push(req.toolChoice);
        if (req.toolChoice === "none") return { text: "done", toolCalls: [] };
        return { text: "", toolCalls: [1, 2].map((n) => ({ id: "c" + (++calls), name: "get_ticket", arguments: { ticket_id: n } })) };
      },
      lookup: async () => ({ label: "t", content: "ok" }),
    });
    expect(res.text).toBe("done");
    expect(res.fetched).toHaveLength(3); // 2 + 1; the 4th call got a "limit reached" error
    expect(seen).toEqual(["auto", "auto", "none"]);
  });

  test("passes lookup errors to the AI and lists them as failed", async () => {
    const replies = [
      { text: "", toolCalls: [{ id: "a", name: "get_ticket", arguments: {} }] },
      { text: "Couldn't read it.", toolCalls: [] },
    ];
    let toolMsg;
    const res = await aa.runToolLoop({ system: "s", question: "q", tools }, {
      chat: async (req) => { toolMsg = req.messages[req.messages.length - 1]; return replies.shift(); },
      lookup: async () => ({ error: "404", content: "Error: 404" }),
    });
    expect(toolMsg.content).toBe("Error: 404");
    expect(res.fetched[0].error).toBe("404");
  });

  test("throws the AI's error", async () => {
    await expect(aa.runToolLoop({ system: "s", question: "q", tools }, {
      chat: async () => ({ error: "No AI provider configured." }),
      lookup: async () => ({}),
    })).rejects.toThrow("No AI provider configured.");
  });
});

describe("ai-assistant prompts and rendering", () => {
  test("system prompt names the site, date, open ticket and read-only rule", () => {
    const p = aa.buildSystemPrompt({ siteName: "Freshservice", today: "2026-11-23", openTicketId: "42" });
    expect(p).toContain("Freshservice");
    expect(p).toContain("2026-11-23");
    expect(p).toContain("#42");
    expect(p).toContain("only read data");
  });

  test("escapes HTML and links ticket numbers only with a link base", () => {
    const html = aa.answerToHtml("**Hi** <b>x</b> see #12 and a&#13;\n- one", "https://x/a/tickets/");
    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('data-ticket="12"');
    expect(html).not.toContain('data-ticket="13"');
    expect(html).toContain("<ul><li>one</li></ul>");
    expect(aa.answerToHtml("see #12", "")).not.toContain("data-ticket");
  });
});

// ===== AI Features tool calling =====

describe("ai-features tool-chat", () => {
  const req = toolChat.checkRequest({
    system: "sys",
    tools: [{ name: "get_ticket", description: "Read", parameters: { type: "object", properties: { ticket_id: { type: "integer" } } } }],
    messages: [
      { role: "user", text: "q" },
      { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "get_ticket", arguments: { ticket_id: 1 } }, { id: "c2", name: "get_ticket", arguments: { ticket_id: 2 } }] },
      { role: "tool", id: "c1", name: "get_ticket", content: "one" },
      { role: "tool", id: "c2", name: "get_ticket", content: "two" },
    ],
  });

  test("only Azure OpenAI, OpenAI and Anthropic do tool calling", () => {
    expect(["azure", "openai", "anthropic"].every(toolChat.supportsTools)).toBe(true);
    expect(["copilotweb", "m365copilot", "hatz", "none"].some(toolChat.supportsTools)).toBe(false);
  });

  test("rejects bad requests", () => {
    expect(toolChat.checkRequest({ messages: [] }).error).toBeTruthy();
    expect(toolChat.checkRequest({ messages: [{ role: "system", text: "x" }] }).error).toBeTruthy();
    expect(toolChat.checkRequest({ messages: [{ role: "user", text: "x" }], tools: [{ name: "bad name!" }] }).error).toBeTruthy();
    expect(toolChat.checkRequest({ messages: [{ role: "tool", content: "x" }] }).error).toBeTruthy();
    expect(toolChat.checkRequest({ messages: [{ role: "user", text: "x".repeat(200000) }] }).error).toMatch(/too large/);
    expect(req.toolChoice).toBe("auto");
  });

  test("builds an OpenAI / Azure request and reads tool calls back", () => {
    const body = toolChat.toOpenAiBody(req, "my-deployment");
    expect(body.model).toBe("my-deployment");
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(body.messages[2].tool_calls[0]).toEqual({ id: "c1", type: "function", function: { name: "get_ticket", arguments: "{\"ticket_id\":1}" } });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "one" });
    expect(body.tools[0].function.name).toBe("get_ticket");
    expect(body.tool_choice).toBe("auto");

    const res = toolChat.fromOpenAiResponse({ choices: [{ message: { content: null, tool_calls: [
      { id: "x", type: "function", function: { name: "get_ticket", arguments: "{\"ticket_id\":5}" } },
      { id: "y", type: "function", function: { name: "get_ticket", arguments: "not json" } },
    ] } }] });
    expect(res).toEqual({ text: "", toolCalls: [
      { id: "x", name: "get_ticket", arguments: { ticket_id: 5 } },
      { id: "y", name: "get_ticket", arguments: {} },
    ] });
    expect(toolChat.fromOpenAiResponse({ choices: [{ message: { content: "Hi" } }] })).toEqual({ text: "Hi", toolCalls: [] });
  });

  test("builds an Anthropic request with tool results in one user turn", () => {
    const body = toolChat.toAnthropicBody(Object.assign({}, req, { toolChoice: "none" }), "claude-x");
    expect(body.system).toBe("sys");
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].content.map((b) => b.type)).toEqual(["tool_use", "tool_use"]);
    expect(body.messages[2].content).toEqual([
      { type: "tool_result", tool_use_id: "c1", content: "one" },
      { type: "tool_result", tool_use_id: "c2", content: "two" },
    ]);
    expect(body.tools[0].input_schema.properties.ticket_id.type).toBe("integer");
    expect(body.tool_choice).toEqual({ type: "none" });

    const res = toolChat.fromAnthropicResponse({ content: [
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "t1", name: "get_ticket", input: { ticket_id: 3 } },
    ] });
    expect(res).toEqual({ text: "Let me check.", toolCalls: [{ id: "t1", name: "get_ticket", arguments: { ticket_id: 3 } }] });
  });
});

// ===== Freshservice lookups =====

function fakeCtx(responses) {
  const calls = [];
  return {
    calls,
    domain: "acme.freshservice.com",
    get: async (what, path) => {
      calls.push(path);
      for (const [prefix, value] of responses) {
        if (path.startsWith(prefix)) {
          if (value instanceof Error) throw value;
          return typeof value === "function" ? value(path) : value;
        }
      }
      return {};
    },
    labels: async () => ({ status: { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed", 6: "Awaiting Vendor" }, priority: { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" } }),
    ticketText: async (id) => "Ticket #" + id + ": Printer jam",
    myAgentId: async () => 42,
    openStatusQuery: async () => "(status:2 OR status:3 OR status:6 OR status:>6)",
  };
}

describe("freshservice assistant lookups", () => {
  test("lists only read-only tools with valid names", () => {
    const names = fsTools.TOOLS.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_ticket", "filter_tickets", "find_requester", "find_assets", "search_solutions"]));
    for (const t of fsTools.TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.parameters.type).toBe("object");
      expect(t.name).not.toMatch(/^(update|create|delete|add|set)_/);
    }
  });

  test("checks filter queries", () => {
    expect(fsTools.checkFilterQuery("requester_id:5 AND created_at:>'2026-10-01'")).toEqual({ query: "requester_id:5 AND created_at:>'2026-10-01'" });
    expect(fsTools.checkFilterQuery("(status:<4 OR status:>5) AND group_id:9").query).toBeTruthy();
    expect(fsTools.checkFilterQuery("status:2\" OR \"x").error).toMatch(/single quotes/);
    expect(fsTools.checkFilterQuery("NOT status:4").error).toMatch(/no NOT/);
    expect(fsTools.checkFilterQuery("status:2; drop").error).toBeTruthy();
    expect(fsTools.checkFilterQuery("").error).toBeTruthy();
    expect(fsTools.checkFilterQuery("a".repeat(513)).error).toMatch(/512/);
  });

  test("refuses unknown tools and bad arguments", async () => {
    const ctx = fakeCtx([]);
    expect((await fsTools.lookup(ctx, "update_ticket", { id: 1 })).error).toMatch(/Unknown lookup/);
    expect((await fsTools.lookup(ctx, "get_ticket", { ticket_id: "abc" })).error).toMatch(/ticket number/);
    expect((await fsTools.lookup(ctx, "find_requester", {})).error).toMatch(/email address or a name/);
    expect(ctx.calls).toEqual([]);
  });

  test("get_ticket returns the ticket text with a link", async () => {
    const res = await fsTools.lookup(fakeCtx([]), "get_ticket", { ticket_id: "#77" });
    expect(res.label).toBe("ticket #77");
    expect(res.link).toBe("https://acme.freshservice.com/a/tickets/77");
    expect(res.content).toContain("Ticket #77: Printer jam");
  });

  test("filter_tickets wraps the query, labels statuses and reports the total", async () => {
    const ctx = fakeCtx([["/tickets/filter", { total: 41, tickets: [
      { id: 9, subject: "VPN", status: 6, priority: 3, requester_id: 5, responder_id: 2, group_id: 3, created_at: "2026-11-01" },
    ] }]]);
    const res = await fsTools.lookup(ctx, "filter_tickets", { query: "requester_id:5", page: 2 });
    expect(ctx.calls[0]).toBe("/tickets/filter?query=" + encodeURIComponent("\"requester_id:5\"") + "&page=2");
    const data = JSON.parse(res.content);
    expect(data.total).toBe(41);
    expect(data.tickets[0]).toMatchObject({ id: 9, status: "Awaiting Vendor", priority: "High", agent_id: 2 });
    expect(res.label).toBe("41 tickets matching requester_id:5");
  });

  test("find_requester by email and by name", async () => {
    const people = { requesters: [
      { id: 1, first_name: "Jane", last_name: "Doe", primary_email: "jane@x.com", job_title: "CFO" },
      { id: 2, first_name: "Jane", last_name: "Smith", primary_email: "js@x.com" },
    ] };
    let ctx = fakeCtx([["/requesters", people]]);
    let res = await fsTools.lookup(ctx, "find_requester", { email: "Jane@X.com" });
    expect(ctx.calls[0]).toBe("/requesters?email=jane%40x.com");
    expect(JSON.parse(res.content).requesters).toHaveLength(2);

    ctx = fakeCtx([["/requesters", people]]);
    res = await fsTools.lookup(ctx, "find_requester", { name: "jane smi'th" });
    expect(decodeURIComponent(ctx.calls[0])).toBe("/requesters?query=\"~[first_name|last_name|primary_email]:'jane'\"");
    // "smi th" after quote stripping → both words must match.
    expect(JSON.parse(res.content).requesters.map((p) => p.id)).toEqual([2]);
  });

  test("find_assets tries name, then tag, then serial number", async () => {
    const ctx = fakeCtx([
      ["/assets?search=" + encodeURIComponent("\"name:"), { assets: [] }],
      ["/assets?search=" + encodeURIComponent("\"asset_tag:"), { assets: [{ display_id: 12, name: "Dell 5540", asset_tag: "AT-1", user_id: 5 }] }],
    ]);
    const res = await fsTools.lookup(ctx, "find_assets", { search: "AT-1" });
    expect(ctx.calls).toHaveLength(2);
    expect(JSON.parse(res.content)).toMatchObject({ matched_on: "asset_tag", assets: [{ display_id: 12, name: "Dell 5540" }] });

    const byUser = fakeCtx([["/assets?filter=", { assets: [{ display_id: 3, name: "iPhone" }] }]]);
    await fsTools.lookup(byUser, "find_assets", { user_id: 5 });
    expect(decodeURIComponent(byUser.calls[0])).toBe("/assets?filter=\"user_id:5\"");
  });

  test("get_asset keeps type fields without their type id suffix", async () => {
    const ctx = fakeCtx([["/assets/12", { asset: { display_id: 12, name: "Dell", type_fields: { serial_number_7001: "ABC", warranty_7001: null } } }]]);
    const data = JSON.parse((await fsTools.lookup(ctx, "get_asset", { display_id: 12 })).content);
    expect(data.type_fields).toEqual({ serial_number: "ABC" });
    expect(data.link).toBe("https://acme.freshservice.com/cmdb/items/12");
  });

  test("get_change labels status and keeps planned dates", async () => {
    const ctx = fakeCtx([["/changes/4", { change: { id: 4, subject: "Patch", status: 3, priority: 2, planned_start_date: "2026-12-01T10:00:00Z", description_text: "Do it" } }]]);
    const data = JSON.parse((await fsTools.lookup(ctx, "get_change", { change_id: 4 })).content);
    expect(data).toMatchObject({ status: "Awaiting Approval", priority: "Medium", planned_start_date: "2026-12-01T10:00:00Z", description: "Do it" });
  });

  test("API errors come back as content the AI can read", async () => {
    const ctx = fakeCtx([["/requesters/9", new Error("Requester not found in Freshservice (404).")]]);
    const res = await fsTools.lookup(ctx, "get_requester", { requester_id: 9 });
    expect(res.error).toMatch(/404/);
    expect(res.content).toBe("Error: Requester not found in Freshservice (404).");
  });

  test("long results are cut short", () => {
    expect(fsTools.trimResult("x".repeat(7000))).toHaveLength(fsTools.MAX_RESULT_CHARS + "… (cut short)".length);
  });

  test("the ticket header lists the ids the AI can look up next", () => {
    expect(fsMain.assistantTicketHeader({ requester_id: 5, responder_id: 2, group_id: 3, tags: ["vpn"] }))
      .toBe("[requester_id 5 | agent_id 2 | group_id 3 | tags vpn]\n");
    expect(fsMain.assistantTicketHeader({})).toBe("");
  });
});

// ===== Negotiation for AIs without tool calling =====

describe("ai-assistant lookup requests", () => {
  const names = ["get_ticket", "find_requester", "filter_tickets"];

  test("reads a LOOKUP line, a code block or a {lookups} object", () => {
    expect(aa.parseLookupRequest('LOOKUP [{"tool": "get_ticket", "args": {"ticket_id": 12}}]', names))
      .toEqual([{ tool: "get_ticket", args: { ticket_id: 12 } }]);
    expect(aa.parseLookupRequest('I need more.\n```json\n[{"tool":"find_requester","args":{"email":"a@b.com"}},\n {"tool":"filter_tickets","args":{"query":"status:2 AND group_id:{x}"}}]\n```', names))
      .toEqual([{ tool: "find_requester", args: { email: "a@b.com" } }, { tool: "filter_tickets", args: { query: "status:2 AND group_id:{x}" } }]);
    expect(aa.parseLookupRequest('{"lookups": [{"tool": "get_ticket", "args": {"ticket_id": 3}}]}', names))
      .toEqual([{ tool: "get_ticket", args: { ticket_id: 3 } }]);
  });

  test("copes with smart quotes and ignores unknown tools and answers", () => {
    expect(aa.parseLookupRequest("LOOKUP [{“tool”: “get_ticket”, “args”: {“ticket_id”: 5}}]", names))
      .toEqual([{ tool: "get_ticket", args: { ticket_id: 5 } }]);
    expect(aa.parseLookupRequest('LOOKUP [{"tool": "update_ticket", "args": {"id": 1}}]', names)).toEqual([]);
    expect(aa.parseLookupRequest("Ticket #12 is about printers. {not json}", names)).toEqual([]);
  });

  test("strips a leftover request from a final answer", () => {
    expect(aa.stripLookupRequest('Here is what I know.\nLOOKUP [{"tool":"get_ticket","args":{}}]')).toBe("Here is what I know.");
    expect(aa.stripLookupRequest('```json\n[{"tool":"get_ticket"}]\n```')).toBe("");
  });

  test("lists the lookups and how to ask only while lookups are left", () => {
    const tools = [{ name: "get_ticket", description: "Read a ticket.", parameters: { type: "object", properties: { ticket_id: { type: "integer" } }, required: ["ticket_id"] } }];
    expect(aa.describeTools(tools)).toBe("- get_ticket(ticket_id: integer): Read a ticket.");
    const asking = aa.buildGatherPrompt("q", [], [], { tools, lookupsLeft: 4 }, 0);
    expect(asking).toContain("LOOKUP [");
    expect(asking).toContain("at most 4 lookups");
    const final = aa.buildGatherPrompt("q", [], [], { tools, lookupsLeft: 0 }, 0);
    expect(final).not.toContain("LOOKUP [");
    expect(final).toContain("No more lookups are possible");
  });
});

describe("ai-assistant negotiation loop", () => {
  const tools = [{ name: "get_ticket", parameters: { type: "object", properties: {} } }, { name: "find_requester", parameters: { type: "object", properties: {} } }];

  test("runs what the AI asks for, then sends the results back for an answer", async () => {
    const prompts = [];
    const replies = ['LOOKUP [{"tool":"find_requester","args":{"email":"bob@x.com"}}]', "Bob has 2 open tickets."];
    const res = await aa.runNegotiation({
      question: "how many tickets has bob@x.com got?", tools,
      results: [{ tool: "get_ticket", args: { ticket_id: 1 }, label: "ticket #1", content: "Ticket #1" }],
    }, {
      complete: async (prompt) => { prompts.push(prompt); return { result: replies.shift() }; },
      lookup: async (tool, args) => ({ label: "requester " + args.email, content: '{"requesters":[{"id":5}]}' }),
    });
    expect(res.text).toBe("Bob has 2 open tickets.");
    expect(res.rounds).toBe(1);
    expect(res.results.map((r) => r.label)).toEqual(["ticket #1", "requester bob@x.com"]);
    expect(prompts[0]).toContain("at most 7 lookups");
    expect(prompts[1]).toContain('<data source="requester bob@x.com">');
  });

  test("doesn't repeat a lookup and stops after the round limit", async () => {
    const lookups = [];
    let n = 0;
    const res = await aa.runNegotiation({ question: "q", tools, maxRounds: 2 }, {
      complete: async (prompt) => {
        if (!prompt.includes("LOOKUP [")) return { result: "Final answer." };
        return { result: 'LOOKUP [{"tool":"get_ticket","args":{"ticket_id":' + (++n) + "}}]" };
      },
      lookup: async (tool, args) => { lookups.push(args.ticket_id); return { label: "t", content: "x" }; },
    });
    expect(lookups).toEqual([1, 2]);
    expect(res.text).toBe("Final answer.");

    const again = await aa.runNegotiation({ question: "q", tools, results: [{ tool: "get_ticket", args: { ticket_id: 9 }, content: "x" }] }, {
      complete: async () => ({ result: 'LOOKUP [{"tool":"get_ticket","args":{"ticket_id":9}}]' }),
      lookup: async () => { throw new Error("should not run"); },
    });
    expect(again.text).toMatch(/more data than I can look up/);
  });

  test("caps the lookups across rounds and throws the AI's error", async () => {
    const asked = [];
    await aa.runNegotiation({ question: "q", tools, maxLookups: 3 }, {
      complete: async (prompt) => (prompt.includes("LOOKUP [")
        ? { result: "LOOKUP " + JSON.stringify([1, 2, 3, 4, 5].map((i) => ({ tool: "get_ticket", args: { ticket_id: i + asked.length } }))) }
        : { result: "done" }),
      lookup: async (tool, args) => { asked.push(args.ticket_id); return { content: "x" }; },
    });
    expect(asked).toHaveLength(3);
    await expect(aa.runNegotiation({ question: "q", tools }, {
      complete: async () => ({ error: "Copilot didn't reply in time." }),
      lookup: async () => ({}),
    })).rejects.toThrow("Copilot didn't reply in time.");
  });
});

describe("ai-assistant my tickets", () => {
  test("spots questions about the agent's own tickets", () => {
    for (const q of ["Please help determine which of my open tickets should be worked on next.", "what's in my queue", "tickets assigned to me", "What should I work on next?"]) {
      expect(aa.wantsMyTickets(q)).toBe(true);
    }
    expect(aa.wantsMyTickets("summarise ticket #12")).toBe(false);
    expect(aa.planGather("which of my open tickets is most urgent?", "")).toEqual([{ tool: "my_open_tickets", args: {} }]);
  });

  test("my_open_tickets filters by the key's agent and open statuses", async () => {
    const ctx = fakeCtx([["/tickets/filter", { total: 2, tickets: [
      { id: 7, subject: "Printer", status: 2, priority: 4, due_by: "2026-11-24T10:00:00Z", fr_due_by: "2026-11-23T12:00:00Z", is_escalated: true },
      { id: 8, subject: "VPN", status: 6, priority: 2 },
    ] }]]);
    const res = await fsTools.lookup(ctx, "my_open_tickets", {});
    expect(decodeURIComponent(ctx.calls[0])).toBe("/tickets/filter?query=\"agent_id:42 AND (status:2 OR status:3 OR status:6 OR status:>6)\"&page=1");
    const data = JSON.parse(res.content);
    expect(data.total).toBe(2);
    expect(data.tickets[0]).toMatchObject({ id: 7, priority: "Urgent", first_response_due_by: "2026-11-23T12:00:00Z", escalated: true });
    expect(res.label).toBe("your 2 open tickets");
  });
});
