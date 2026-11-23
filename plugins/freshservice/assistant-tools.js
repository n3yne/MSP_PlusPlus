"use strict";

// Read-only Freshservice lookups for the AI Assistant plugin.
//
// TOOLS describes each lookup to the AI (name, what it does, JSON-schema
// arguments); runLookup() runs one. Every lookup is a GET to the configured
// Freshservice domain, through the ctx the main process passes in, so nothing
// here can change data or reach another server. Results are trimmed to a few
// thousand characters before they go back to the AI.
//
// ctx: {
//   get(what, pathAndQuery) → parsed JSON (throws a readable Error),
//   labels()                → { status: {2: "Open"…}, priority: {…} },
//   ticketText(id)          → the ticket and its conversations as text,
//   domain                  → the Freshservice host, for links,
// }

const MAX_RESULT_CHARS = 6000;
const MAX_TICKET_TEXT_CHARS = 8000;
const MAX_LIST_RESULTS = 30;
const MAX_PEOPLE_RESULTS = 5;
const MAX_ASSET_RESULTS = 10;
const MAX_ARTICLE_RESULTS = 5;
const MAX_FILTER_QUERY_CHARS = 512;
const MAX_TERM_CHARS = 100;
const MAX_DESCRIPTION_CHARS = 1500;
const MAX_FIELD_CHARS = 300;
const EMAIL_PATTERN = /^[^\s@"'<>\\,]{1,64}@[^\s@"'<>\\,]{1,253}$/;

const ID_SCHEMA = { type: "integer", minimum: 1 };

const TOOLS = [
  {
    name: "get_ticket",
    description: "Read one Freshservice ticket: subject, status, priority, requester, agent, group, dates, description and its replies and notes.",
    parameters: {
      type: "object",
      properties: { ticket_id: Object.assign({ description: "The ticket number, e.g. 4521." }, ID_SCHEMA) },
      required: ["ticket_id"],
    },
  },
  {
    name: "filter_tickets",
    description:
      "List tickets matching a Freshservice filter query (newest first, up to 30, plus the total count). " +
      "Fields: status (2 Open, 3 Pending, 4 Resolved, 5 Closed, or a custom status number), priority (1 Low, 2 Medium, 3 High, 4 Urgent), " +
      "requester_id, agent_id, group_id, department_id, type ('Incident' or 'Service Request'), tag, " +
      "created_at, updated_at, due_by (dates as 'YYYY-MM-DD' with :> or :<). " +
      "Combine with AND / OR and parentheses. Strings and dates use single quotes. There is no NOT: " +
      "for 'not resolved or closed' use (status:<4 OR status:>5). " +
      "Example: requester_id:123 AND created_at:>'2026-10-01'. Find ids first with find_requester, find_agent or list_groups.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The filter query, without surrounding double quotes." },
        page: { type: "integer", minimum: 1, maximum: 10, description: "Page of 30 results, default 1." },
      },
      required: ["query"],
    },
  },
  {
    name: "find_requester",
    description: "Find requesters (end users) by email address or by name. Returns ids, names, emails, job titles, phone numbers and department ids.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Exact email address." },
        name: { type: "string", description: "First name, last name or both." },
      },
    },
  },
  {
    name: "get_requester",
    description: "Read one requester (end user) by id: name, email, job title, phones, department and location ids, and whether they are active.",
    parameters: {
      type: "object",
      properties: { requester_id: ID_SCHEMA },
      required: ["requester_id"],
    },
  },
  {
    name: "find_agent",
    description: "Find agents (service desk staff) by email address or by name. Returns ids, names and emails.",
    parameters: {
      type: "object",
      properties: {
        email: { type: "string", description: "Exact email address." },
        name: { type: "string", description: "First name, last name or both." },
      },
    },
  },
  {
    name: "list_groups",
    description: "List the agent groups (teams tickets are assigned to) with their ids.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "find_assets",
    description: "Find assets (devices, software, etc.) by name, asset tag or serial number, or the assets used by one requester or agent (user_id).",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Asset name, asset tag or serial number." },
        user_id: Object.assign({ description: "Requester or agent id whose assets to list." }, ID_SCHEMA),
      },
    },
  },
  {
    name: "get_asset",
    description: "Read one asset by its display id (the number in the asset's URL): name, tag, type, user, department, dates, description and type-specific fields.",
    parameters: {
      type: "object",
      properties: { display_id: ID_SCHEMA },
      required: ["display_id"],
    },
  },
  {
    name: "get_problem",
    description: "Read one Freshservice problem record by number.",
    parameters: {
      type: "object",
      properties: { problem_id: ID_SCHEMA },
      required: ["problem_id"],
    },
  },
  {
    name: "get_change",
    description: "Read one Freshservice change record by number, including its planned start and end.",
    parameters: {
      type: "object",
      properties: { change_id: ID_SCHEMA },
      required: ["change_id"],
    },
  },
  {
    name: "search_solutions",
    description: "Search the Solutions (knowledge base) articles. Returns titles, links and the start of each article.",
    parameters: {
      type: "object",
      properties: { term: { type: "string", description: "A few keywords." } },
      required: ["term"],
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

// ===== Argument helpers =====

function toId(v) {
  const n = typeof v === "string" && /^#?\d{1,15}$/.test(v.trim()) ? Number(v.trim().replace("#", "")) : v;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// A search word or name safe to put inside a filter's single quotes.
function cleanTerm(v) {
  return String(v == null ? "" : v).replace(/['"\\]/g, " ").replace(/\s+/g, " ").trim().substring(0, MAX_TERM_CHARS);
}

function cleanEmail(v) {
  const e = String(v == null ? "" : v).trim().toLowerCase();
  return EMAIL_PATTERN.test(e) ? e : "";
}

function clip(v, max) {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? s.substring(0, max) + "…" : s;
}

function str(v) {
  return typeof v === "string" ? clip(v, MAX_FIELD_CHARS) : "";
}

function idOrNull(v) {
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}

// Drops empty values so results stay short.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function bodyText(item, textField, htmlField) {
  const text = typeof item[textField] === "string" ? item[textField] : "";
  return clip(text.trim() ? text : htmlToText(item[htmlField]), MAX_DESCRIPTION_CHARS);
}

function personName(p) {
  const name = typeof p.name === "string" && p.name.trim()
    ? p.name
    : [p.first_name, p.last_name].filter((x) => typeof x === "string" && x.trim()).join(" ");
  return clip(name, 200);
}

// ===== Formatters =====

function formatTicketRow(t, labels) {
  if (!t || typeof t !== "object" || !idOrNull(t.id)) return null;
  return compact({
    id: t.id,
    subject: str(t.subject),
    status: labels.status[t.status] || t.status,
    priority: labels.priority[t.priority] || t.priority,
    type: str(t.type),
    requester_id: idOrNull(t.requester_id),
    agent_id: idOrNull(t.responder_id),
    group_id: idOrNull(t.group_id),
    created_at: str(t.created_at),
    updated_at: str(t.updated_at),
    due_by: str(t.due_by),
  });
}

function formatRequester(r) {
  if (!r || typeof r !== "object" || !idOrNull(r.id)) return null;
  return compact({
    id: r.id,
    name: personName(r),
    email: str(r.primary_email || r.email),
    secondary_emails: Array.isArray(r.secondary_emails) ? r.secondary_emails.slice(0, 3).map(str).filter(Boolean) : [],
    job_title: str(r.job_title),
    work_phone: str(r.work_phone_number),
    mobile_phone: str(r.mobile_phone_number),
    department_ids: Array.isArray(r.department_ids) ? r.department_ids.filter(idOrNull).slice(0, 10) : [],
    location_id: idOrNull(r.location_id),
    reporting_manager_id: idOrNull(r.reporting_manager_id),
    active: typeof r.active === "boolean" ? r.active : null,
    is_agent: r.is_agent === true ? true : null,
  });
}

function formatAgentRow(a) {
  if (!a || typeof a !== "object" || !idOrNull(a.id)) return null;
  return compact({
    id: a.id,
    name: personName(a),
    email: str(a.email),
    job_title: str(a.job_title),
    active: typeof a.active === "boolean" ? a.active : null,
  });
}

function formatAsset(a, full) {
  if (!a || typeof a !== "object" || !idOrNull(a.display_id || a.id)) return null;
  const out = {
    display_id: idOrNull(a.display_id),
    name: str(a.name),
    asset_tag: str(a.asset_tag),
    asset_type_id: idOrNull(a.asset_type_id),
    impact: str(a.impact),
    user_id: idOrNull(a.user_id),
    agent_id: idOrNull(a.agent_id),
    department_id: idOrNull(a.department_id),
    location_id: idOrNull(a.location_id),
    group_id: idOrNull(a.group_id),
    assigned_on: str(a.assigned_on),
    updated_at: str(a.updated_at),
  };
  if (full) {
    out.description = bodyText(a, "description_text", "description");
    out.created_at = str(a.created_at);
    if (a.type_fields && typeof a.type_fields === "object") {
      const fields = {};
      for (const [k, v] of Object.entries(a.type_fields).slice(0, 40)) {
        if (v === null || v === undefined || v === "") continue;
        // Type field keys end in the asset type id ("serial_number_7001"); drop it.
        const key = String(k).replace(/_\d+$/, "").substring(0, 60);
        fields[key] = typeof v === "string" ? clip(v, 200) : (typeof v === "number" || typeof v === "boolean" ? v : undefined);
      }
      out.type_fields = compact(fields);
    }
  }
  return compact(out);
}

const RECORD_STATUS = {
  problem: { 1: "Open", 2: "Change Requested", 3: "Closed" },
  change: { 1: "Open", 2: "Planning", 3: "Awaiting Approval", 4: "Pending Release", 5: "Pending Review", 6: "Closed" },
};

function formatRecord(kind, r, labels) {
  if (!r || typeof r !== "object" || !idOrNull(r.id)) return null;
  return compact({
    id: r.id,
    subject: str(r.subject),
    status: RECORD_STATUS[kind][r.status] || r.status,
    priority: labels.priority[r.priority] || r.priority,
    impact: r.impact,
    risk: kind === "change" ? r.risk : undefined,
    change_type: kind === "change" ? r.change_type : undefined,
    requester_id: idOrNull(r.requester_id),
    agent_id: idOrNull(r.agent_id),
    group_id: idOrNull(r.group_id),
    department_id: idOrNull(r.department_id),
    planned_start_date: str(r.planned_start_date),
    planned_end_date: str(r.planned_end_date),
    due_by: str(r.due_by),
    known_error: kind === "problem" && r.known_error === true ? true : undefined,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
    description: bodyText(r, "description_text", "description"),
  });
}

// ===== Filter query checks =====

// The AI writes filter queries, so make sure one is the plain filter syntax:
// no double quotes (the query is wrapped in them), nothing that isn't
// field:value, AND, OR or parentheses, and at most 512 characters.
function checkFilterQuery(raw) {
  const q = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (!q) return { error: "The filter query is empty." };
  if (q.length > MAX_FILTER_QUERY_CHARS) return { error: `The filter query is longer than ${MAX_FILTER_QUERY_CHARS} characters.` };
  if (/["\\]/.test(q)) return { error: "Use single quotes in the filter query, not double quotes or backslashes." };
  if (/\bNOT\b/i.test(q)) return { error: "Freshservice filters have no NOT. Use ranges such as (status:<4 OR status:>5)." };
  if (!/^[\w\s:'<>().@+\-,/]+$/.test(q)) return { error: "The filter query has characters Freshservice filters don't use." };
  return { query: q };
}

// ===== Running a lookup =====

function trimResult(value, max) {
  const limit = max || MAX_RESULT_CHARS;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? text.substring(0, limit) + "… (cut short)" : text;
}

function list(json, key) {
  return json && Array.isArray(json[key]) ? json[key] : [];
}

// Requesters or agents matching a name: a "starts with" filter on the first
// word, then every word must appear in the name or email.
function nameMatches(person, words) {
  const hay = (personName(person) + " " + (person.primary_email || person.email || "")).toLowerCase();
  return words.every((w) => hay.includes(w));
}

async function findPeople(ctx, kind, args) {
  const collection = kind === "agent" ? "agents" : "requesters";
  const format = kind === "agent" ? formatAgentRow : formatRequester;
  const what = kind === "agent" ? "Agent" : "Requester";
  const email = cleanEmail(args.email);
  if (email) {
    const json = await ctx.get(what, `/${collection}?email=${encodeURIComponent(email)}`);
    const people = list(json, collection).map(format).filter(Boolean).slice(0, MAX_PEOPLE_RESULTS);
    return { label: `${kind} ${email}`, data: { [collection]: people, note: people.length ? undefined : "No " + kind + " has that email." } };
  }
  const name = cleanTerm(args.name);
  const words = name.toLowerCase().split(" ").filter(Boolean);
  if (!words.length || words[0].length < 2) return { error: "Give an email address or a name of at least 2 letters." };
  const emailField = kind === "agent" ? "email" : "primary_email";
  const query = `~[first_name|last_name|${emailField}]:'${words[0]}'`;
  const json = await ctx.get(what, `/${collection}?query=${encodeURIComponent("\"" + query + "\"")}`);
  const all = list(json, collection);
  const matched = all.filter((p) => nameMatches(p, words));
  const people = (matched.length ? matched : all).map(format).filter(Boolean).slice(0, MAX_PEOPLE_RESULTS);
  return { label: `${kind} “${name}”`, data: { [collection]: people, note: people.length ? undefined : "No " + kind + " matches that name." } };
}

async function runLookup(ctx, tool, rawArgs) {
  if (!TOOL_NAMES.has(tool)) return { error: "Unknown lookup: " + String(tool).substring(0, 50) };
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs : {};

  switch (tool) {
    case "get_ticket": {
      const id = toId(args.ticket_id);
      if (!id) return { error: "ticket_id must be a ticket number." };
      const text = await ctx.ticketText(id);
      return {
        label: `ticket #${id}`,
        link: ctx.domain ? `https://${ctx.domain}/a/tickets/${id}` : "",
        text: String(text || "").substring(0, MAX_TICKET_TEXT_CHARS),
      };
    }

    case "filter_tickets": {
      const checked = checkFilterQuery(args.query);
      if (checked.error) return checked;
      const page = Math.min(Math.max(toId(args.page) || 1, 1), 10);
      const [json, labels] = await Promise.all([
        ctx.get("Ticket filter", "/tickets/filter?query=" + encodeURIComponent("\"" + checked.query + "\"") + "&page=" + page),
        ctx.labels(),
      ]);
      const tickets = list(json, "tickets").map((t) => formatTicketRow(t, labels)).filter(Boolean).slice(0, MAX_LIST_RESULTS);
      const total = typeof json.total === "number" ? json.total : tickets.length;
      return {
        label: `${total} ticket${total === 1 ? "" : "s"} matching ${checked.query}`,
        data: { total, page, tickets },
      };
    }

    case "find_requester":
      return findPeople(ctx, "requester", args);

    case "find_agent":
      return findPeople(ctx, "agent", args);

    case "get_requester": {
      const id = toId(args.requester_id);
      if (!id) return { error: "requester_id must be a number." };
      const json = await ctx.get("Requester", `/requesters/${id}`);
      const person = formatRequester(json && json.requester);
      if (!person) return { error: "Freshservice returned no requester." };
      return { label: `requester ${person.name || id}`, data: person };
    }

    case "list_groups": {
      const json = await ctx.get("Group", "/groups?per_page=100");
      const groups = list(json, "groups")
        .filter((g) => g && idOrNull(g.id))
        .map((g) => ({ id: g.id, name: str(g.name) }));
      return { label: "agent groups", data: { groups } };
    }

    case "find_assets": {
      const userId = toId(args.user_id);
      if (userId) {
        const json = await ctx.get("Asset", "/assets?filter=" + encodeURIComponent("\"user_id:" + userId + "\""));
        const assets = list(json, "assets").map((a) => formatAsset(a, false)).filter(Boolean).slice(0, MAX_ASSET_RESULTS);
        return { label: `assets of user ${userId}`, data: { assets } };
      }
      const term = cleanTerm(args.search);
      if (term.length < 2) return { error: "Give a search of at least 2 characters, or a user_id." };
      // The asset search takes one field at a time: try name, then tag, then serial number.
      for (const field of ["name", "asset_tag", "serial_number"]) {
        const json = await ctx.get("Asset", "/assets?search=" + encodeURIComponent(`"${field}:'${term}'"`));
        const assets = list(json, "assets").map((a) => formatAsset(a, false)).filter(Boolean).slice(0, MAX_ASSET_RESULTS);
        if (assets.length) return { label: `assets “${term}”`, data: { matched_on: field, assets } };
      }
      return { label: `assets “${term}”`, data: { assets: [], note: "No asset has that name, tag or serial number." } };
    }

    case "get_asset": {
      const id = toId(args.display_id);
      if (!id) return { error: "display_id must be a number." };
      const json = await ctx.get("Asset", `/assets/${id}?include=type_fields`);
      const asset = formatAsset(json && json.asset, true);
      if (!asset) return { error: "Freshservice returned no asset." };
      return { label: `asset ${asset.name || "#" + id}`, link: ctx.domain ? `https://${ctx.domain}/cmdb/items/${id}` : "", data: asset };
    }

    case "get_problem":
    case "get_change": {
      const kind = tool === "get_problem" ? "problem" : "change";
      const id = toId(args[kind + "_id"]);
      if (!id) return { error: kind + "_id must be a number." };
      const [json, labels] = await Promise.all([
        ctx.get(kind === "problem" ? "Problem" : "Change", `/${kind}s/${id}`),
        ctx.labels(),
      ]);
      const record = formatRecord(kind, json && json[kind], labels);
      if (!record) return { error: `Freshservice returned no ${kind}.` };
      return { label: `${kind} #${id}`, link: ctx.domain ? `https://${ctx.domain}/a/${kind}s/${id}` : "", data: record };
    }

    case "search_solutions": {
      const term = cleanTerm(args.term);
      if (!term) return { error: "Give a few search words." };
      const json = await ctx.get("Solution article", "/solutions/articles/search?search_term=" + encodeURIComponent(term));
      const articles = list(json, "articles")
        .filter((a) => a && idOrNull(a.id))
        .slice(0, MAX_ARTICLE_RESULTS)
        .map((a) => compact({
          id: a.id,
          title: str(a.title),
          url: ctx.domain ? `https://${ctx.domain}/support/solutions/articles/${a.id}` : "",
          draft: a.status === 1 ? true : null,
          text: clip(bodyText(a, "description_text", "description"), 800),
        }));
      return { label: `Solutions “${term}”`, data: { articles } };
    }
  }
  return { error: "Unknown lookup." };
}

// Runs a lookup and returns { label, content } for the AI, or { error } with
// the error as content so the AI can try something else.
async function lookup(ctx, tool, args) {
  try {
    const res = await runLookup(ctx, tool, args);
    if (res.error) return { error: res.error, content: "Error: " + res.error };
    const body = res.text !== undefined ? res.text : res.data;
    const withLink = res.link
      ? (typeof body === "string" ? "Link: " + res.link + "\n" + body : Object.assign({ link: res.link }, body))
      : body;
    const content = trimResult(withLink, res.text !== undefined ? MAX_TICKET_TEXT_CHARS + 200 : MAX_RESULT_CHARS);
    return { label: res.label, link: res.link || "", content };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return { error: message, content: "Error: " + message };
  }
}

module.exports = {
  TOOLS,
  lookup,
  runLookup,
  checkFilterQuery,
  cleanTerm,
  cleanEmail,
  toId,
  formatTicketRow,
  formatRequester,
  formatAgentRow,
  formatAsset,
  formatRecord,
  trimResult,
  MAX_RESULT_CHARS,
};
