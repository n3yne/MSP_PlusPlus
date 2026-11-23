"use strict";

const crypto = require("crypto");
const assistantTools = require("./assistant-tools");

// Main-process half of the Freshservice site plugin: reads ticket details and
// Solutions articles through the Freshservice REST API v2 (the page-side half,
// the site adapter, is renderer.js). The API key is
// encrypted at rest, only ever decrypted in the main process, and only sent to
// the configured Freshservice domain over https. Callers fall back to scraping
// the page whenever this returns an error or is skipped.

const REQUEST_TIMEOUT_MS = 15000;
const CONVERSATIONS_PER_PAGE = 100;
const MAX_CONVERSATION_PAGES = 5;
const MAX_TEXT_CHARS = 15000;
const MAX_SEARCH_TERM_CHARS = 200;
const MAX_SEARCH_RESULTS = 10;
const MAX_ARTICLE_CHARS = 6000;
const MAX_SNIPPET_CHARS = 500;
// Freshservice caps a filter query at 512 characters.
const MAX_FILTER_QUERY_CHARS = 512;
const DATE_VAR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// The filter endpoint returns 30 tickets a page.
const FILTER_PAGE_SIZE = 30;
const MAX_FILTER_PAGES = 10;
const MAX_CONVERSATION_SNIPPET_CHARS = 300;
const EMAIL_PATTERN = /^[^\s@"<>]{1,64}@[^\s@"<>]{1,253}$/;
// Ticket search. The API has no full-text ticket search, so subjects are
// matched against a scan of recently updated tickets (cached for a couple of
// minutes so typing doesn't re-fetch), and requesters through the requester
// filter, then the ticket filter on their ids.
const MAX_TICKET_SEARCH_CHARS = 100;
const TICKET_SEARCH_DAY_CHOICES = [7, 30, 90, 180, 365];
const DEFAULT_TICKET_SEARCH_DAYS = 30;
const SCAN_PER_PAGE = 100;
const MAX_SCAN_PAGES = 3;
const SCAN_CACHE_MS = 2 * 60 * 1000;
const MAX_MATCHED_REQUESTERS = 5;
const MAX_TICKET_SEARCH_RESULTS = 50;
const MAX_REQUESTER_LOOKUPS = 15;

// Quick actions: how long the status/agent/group choices are kept, and how
// many pages of 100 agents and groups are listed.
const ACTION_OPTIONS_CACHE_MS = 10 * 60 * 1000;
const MAX_AGENT_PAGES = 10;
const MAX_GROUP_PAGES = 5;

// SLA Countdown: the signed-in agent's open tickets with their due times. Up to
// MAX_SLA_PAGES pages of the ticket filter; the first response time (which the
// filter doesn't return) is read per ticket for up to MAX_SLA_STATS_LOOKUPS of
// them, and kept until the ticket's updated_at changes.
const MAX_SLA_PAGES = 5;
const MAX_SLA_STATS_LOOKUPS = 25;
const SLA_STATS_CONCURRENCY = 4;
const SLA_STATS_CACHE_MS = 30 * 60 * 1000;
// The filter for "open" (every status but Resolved and Closed) is built from
// the account's statuses by slaOpenStatusQuery(); the filter has no NOT.
// Statuses whose names mean the SLA clock is normally stopped (Pending, and
// custom ones such as "Awaiting Vendor" or "On Hold"). Freshservice's API
// doesn't say which statuses stop the clock, so this goes by name.
const SLA_PAUSED_LABEL_PATTERN = /^(?:pending|on[ -]?hold|awaiting\b.*|waiting\b.*)$/i;

const STATUS_LABELS = { 2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed" };
const PRIORITY_LABELS = { 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };

// A bare hostname such as acme.freshservice.com (or a custom helpdesk domain).
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

// Freshservice's own hosts. Keep in step with manifest.json "site.hosts".
const FRESHWORKS_HOSTNAME_PATTERN = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/i;

module.exports = {

  defaultSettings: {
    fsApiEnabled: true,
    fsApiDomain: "",
    // Alias host: pages opened on fsAliasHost (a company's own name for their
    // instance) are loaded from fsAliasTarget (its *.freshservice.com host) instead.
    fsAliasHost: "",
    fsAliasTarget: "",
  },

  validateSettings: function (s) {
    if (s.fsApiEnabled !== undefined && typeof s.fsApiEnabled !== "boolean") return false;
    if (s.fsApiDomain !== undefined) {
      if (typeof s.fsApiDomain !== "string" || s.fsApiDomain.length > 300) return false;
      if (s.fsApiDomain && normalizeDomain(s.fsApiDomain) === null) return false;
    }
    if (s.fsApiKey !== undefined && (typeof s.fsApiKey !== "string" || s.fsApiKey.length > 200)) return false;
    if (s.fsApiKeyEncrypted !== undefined && (typeof s.fsApiKeyEncrypted !== "string" || s.fsApiKeyEncrypted.length > 2000)) return false;
    if (s.fsApiKeyHost !== undefined && (typeof s.fsApiKeyHost !== "string" || s.fsApiKeyHost.length > 300)) return false;
    if (s.fsAliasHost !== undefined) {
      if (typeof s.fsAliasHost !== "string") return false;
      if (s.fsAliasHost && (normalizeDomain(s.fsAliasHost) !== s.fsAliasHost || isFreshworksHost(s.fsAliasHost))) return false;
    }
    if (s.fsAliasTarget !== undefined) {
      if (typeof s.fsAliasTarget !== "string") return false;
      if (s.fsAliasTarget && (normalizeDomain(s.fsAliasTarget) !== s.fsAliasTarget || !isFreshworksHost(s.fsAliasTarget))) return false;
    }
    return true;
  },

  init: function (api) {

    // Alias host redirect. The app (0.8.2+) redirects page loads; API calls go
    // through fetch() below and keep using fsApiDomain, whatever it is.
    if (typeof api.setHostRedirects === "function") {
      let lastRedirects = null;
      const applyAliasRedirect = function (settings) {
        const pairs = aliasRedirects(settings);
        const key = JSON.stringify(pairs);
        if (key === lastRedirects) return;
        lastRedirects = key;
        api.setHostRedirects(pairs);
      };
      applyAliasRedirect(api.getSettings());
      api.on("settings:changed", applyAliasRedirect);
    }

    // A custom API domain (a company's own name for the instance) gets what the
    // manifest hosts get from the app (0.8.3+): the Chrome user agent and sign-in
    // popups as real windows. Older apps don't have the hook.
    if (typeof api.setSiteHosts === "function") {
      let lastSiteHosts = null;
      const applySiteHosts = function (settings) {
        const hosts = customSiteHosts(settings);
        const key = JSON.stringify(hosts);
        if (key === lastSiteHosts) return;
        lastSiteHosts = key;
        api.setSiteHosts(hosts);
      };
      applySiteHosts(api.getSettings());
      api.on("settings:changed", applySiteHosts);
    }

    // Encrypt a newly entered key before it reaches disk; never write it in plain text.
    //
    // The key is also tied to the domain it was entered for (fsApiKeyHost), so
    // changing the domain later can never send the saved key to a different
    // server: the key has to be entered again. The tie comes from what is already
    // saved, never from what the caller sent.
    api.registerSettingsTransformer(function (settings) {
      const current = api.getSettings();
      const newKey = Boolean(settings.fsApiKey);
      if (newKey) {
        const encrypted = api.encryptCredential(settings.fsApiKey);
        if (encrypted) settings.fsApiKeyEncrypted = encrypted;
      }
      delete settings.fsApiKey;
      if (settings.fsApiDomain) settings.fsApiDomain = normalizeDomain(settings.fsApiDomain) || "";

      if (newKey) {
        settings.fsApiKeyHost = settings.fsApiDomain || "";
      } else if (settings.fsApiKeyEncrypted) {
        // A key saved before a domain was set is tied to the first domain entered.
        settings.fsApiKeyHost = keyHost(current) || settings.fsApiDomain || "";
      } else {
        delete settings.fsApiKeyHost;
      }
      return settings;
    });

    function getApiKey(settings) {
      if (settings.fsApiKey) return settings.fsApiKey;
      if (settings.fsApiKeyEncrypted) return api.decryptCredential(settings.fsApiKeyEncrypted) || "";
      return "";
    }

    // Returns { domain, key } when the API is enabled and fully set up, else { error }.
    function connection() {
      const s = api.getSettings();
      if (s.fsApiEnabled === false) return { skipped: true, error: "The Freshservice API is turned off." };
      const domain = normalizeDomain(s.fsApiDomain || "");
      if (!domain) return { skipped: true, error: "Enter your Freshservice domain in Settings → Freshservice." };
      const key = getApiKey(s);
      if (!key) return { skipped: true, error: "Enter your Freshservice API key in Settings → Freshservice." };
      const boundTo = keyHost(s);
      if (boundTo && boundTo !== domain) {
        return {
          skipped: true,
          error: "The saved API key was entered for " + boundTo + ". Enter the API key again in Settings → Freshservice to use it with " + domain + ".",
        };
      }
      return { domain, key };
    }

    async function apiGet(conn, pathAndQuery) {
      return apiRequest(conn, pathAndQuery);
    }

    async function apiRequest(conn, pathAndQuery, options) {
      const opts = options || {};
      let resp;
      try {
        const init = {
          method: opts.method || "GET",
          headers: {
            // Freshservice uses Basic auth with the API key as the user name and any password.
            "Authorization": "Basic " + Buffer.from(conn.key + ":X").toString("base64"),
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        };
        if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
        resp = await fetch("https://" + conn.domain + "/api/v2" + pathAndQuery, init);
      } catch (err) {
        if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new Error(`Freshservice did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds`, { cause: err });
        }
        throw new Error("Could not reach Freshservice: " + (err && err.message ? err.message : String(err)), { cause: err });
      }
      if (!resp.ok) {
        let detail = "";
        if (resp.status === 400 && (opts.method === "POST" || opts.method === "PUT")) {
          try { detail = describeValidationErrors(await resp.json()); } catch { /* no JSON body */ }
        }
        const httpErr = new Error(describeHttpError(resp, conn.what) + (detail ? " " + detail : ""));
        httpErr.status = resp.status;
        throw httpErr;
      }
      return resp.json();
    }

    // Caches of what depends on whose API key it is (the agent, the choices
    // offered to them) are keyed by domain and a hash of the key, so entering
    // another agent's key takes effect without a restart.
    function keyCacheId(conn) {
      return conn.domain + "|" + crypto.createHash("sha256").update(String(conn.key)).digest("hex").slice(0, 16);
    }

    // The signed-in agent's id, which a time entry has to name. Looked up once
    // per domain and key through /agents/me (the agent the API key belongs to).
    const agentIdByKey = new Map();
    async function currentAgentId(conn) {
      if (agentIdByKey.has(keyCacheId(conn))) return agentIdByKey.get(keyCacheId(conn));
      const json = await apiGet(Object.assign({}, conn, { what: "Agent" }), "/agents/me");
      const id = json && json.agent && json.agent.id;
      if (typeof id !== "number" && !(typeof id === "string" && /^\d{1,20}$/.test(id))) {
        throw new Error("Freshservice didn't say which agent the API key belongs to.");
      }
      agentIdByKey.set(keyCacheId(conn), id);
      return id;
    }

    // Status and priority names, custom ones included, from /ticket_form_fields,
    // cached per domain. Never throws: on an error the standard names are used,
    // and asked for again after a couple of minutes.
    const labelsCache = new Map(); // domain → { at, value, failed? }
    async function fieldLabels(conn) {
      const cached = labelsCache.get(conn.domain);
      const maxAge = cached && cached.failed ? SCAN_CACHE_MS : ACTION_OPTIONS_CACHE_MS;
      if (cached && Date.now() - cached.at < maxAge) return cached.value;
      try {
        const json = await apiGet(Object.assign({}, conn, { what: "Ticket fields" }), "/ticket_form_fields");
        const value = choicesToLabels(fieldChoices(json));
        labelsCache.set(conn.domain, { at: Date.now(), value });
        return value;
      } catch (err) {
        api.log("ticket field names failed, using the standard ones:", err.message);
        const value = choicesToLabels({});
        labelsCache.set(conn.domain, { at: Date.now(), value, failed: true });
        return value;
      }
    }

    async function fetchConversations(conn, ticketId) {
      const all = [];
      for (let page = 1; page <= MAX_CONVERSATION_PAGES; page++) {
        const json = await apiGet(conn, `/tickets/${ticketId}/conversations?per_page=${CONVERSATIONS_PER_PAGE}&page=${page}`);
        const batch = Array.isArray(json.conversations) ? json.conversations : [];
        all.push(...batch);
        if (batch.length < CONVERSATIONS_PER_PAGE) break;
      }
      return all;
    }

    api.handle("get-ticket", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "Only tickets can be read through the API." };
      const conn = connection();
      if (conn.error) return conn;
      // The page and the API must be the same Freshservice account, or ticket
      // numbers would point at different tickets.
      const host = typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && !sameInstance(host, conn.domain, api.getSettings())) {
        return { skipped: true, error: `The open page (${host}) isn't the configured Freshservice domain.` };
      }
      try {
        const [ticketJson, conversations, labels] = await Promise.all([
          apiGet(conn, `/tickets/${ticketId}?include=requester`),
          fetchConversations(conn, ticketId),
          fieldLabels(conn),
        ]);
        const ticket = ticketJson.ticket || {};
        return { ticketId, text: formatTicketText(ticket, conversations, labels) };
      } catch (err) {
        api.log("get-ticket failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Subject and requester of a ticket, for reply placeholders (Canned Responses).
    api.handle("get-ticket-fields", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "Only tickets can be read through the API." };
      const conn = connection();
      if (conn.error) return conn;
      const host = typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && !sameInstance(host, conn.domain, api.getSettings())) {
        return { skipped: true, error: `The open page (${host}) isn't the configured Freshservice domain.` };
      }
      try {
        const json = await apiGet(conn, `/tickets/${ticketId}?include=requester`);
        return Object.assign({ ticketId }, ticketFields(json.ticket || {}));
      } catch (err) {
        api.log("get-ticket-fields failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Searches the Solutions (knowledge base) articles the API key can see.
    // Returns short entries; use get-solution-article for an article's full text.
    api.handle("search-solutions", async function (data) {
      const term = String((data && data.term) || "").replace(/\s+/g, " ").trim().substring(0, MAX_SEARCH_TERM_CHARS);
      if (!term) return { articles: [] };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Solution article" }, conn),
          "/solutions/articles/search?search_term=" + encodeURIComponent(term));
        const list = Array.isArray(json.articles) ? json.articles : [];
        return {
          articles: list.slice(0, MAX_SEARCH_RESULTS)
            .map((a) => formatArticle(a, conn.domain, MAX_SNIPPET_CHARS))
            .filter(Boolean),
        };
      } catch (err) {
        api.log("search-solutions failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    api.handle("get-solution-article", async function (data) {
      const id = String((data && data.id) || "");
      if (!/^\d{1,20}$/.test(id)) return { error: "Invalid solution article ID." };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Solution article" }, conn), "/solutions/articles/" + id);
        const article = formatArticle(json.article || json, conn.domain, MAX_ARTICLE_CHARS);
        if (!article) return { error: "Freshservice returned no article." };
        return { article };
      } catch (err) {
        api.log("get-solution-article failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Counts the tickets matching a Freshservice filter query, such as
    // "agent_id:123 AND status:2" or "status:4 AND updated_at:>'{weekStart}'".
    // {name} placeholders are filled from data.vars (dates only). Used by the
    // Metrics Bar, which falls back to its dashboard scrape on any error.
    api.handle("count-tickets", async function (data) {
      const built = buildFilterQuery(data && data.query, data && data.vars);
      if (built.error) return built;
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Ticket filter" }, conn),
          "/tickets/filter?query=" + encodeURIComponent("\"" + built.query + "\"") + "&page=1");
        if (typeof json.total !== "number") return { error: "Freshservice returned no ticket count." };
        return { count: json.total, query: built.query };
      } catch (err) {
        api.log("count-tickets failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Adds a time entry to a ticket, change, problem or release, for the agent
    // the API key belongs to. Used by the Time Tracker plugin through the site
    // adapter's timeEntry.log(). data: { kind, id, minutes, note?, billable?, host? }.
    api.handle("add-time-entry", async function (data) {
      const entry = buildTimeEntry(data);
      if (entry.error) return entry;
      const conn = connection();
      if (conn.error) return conn;
      const host = data && typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && !sameInstance(host, conn.domain, api.getSettings())) {
        return { skipped: true, error: `The open page (${host}) isn't the configured Freshservice domain (${conn.domain}).` };
      }
      try {
        const agentId = await currentAgentId(conn);
        const body = Object.assign({ agent_id: agentId }, entry.body);
        const json = await apiRequest(Object.assign({}, conn, { what: "Time entry" }),
          `/${entry.collection}/${entry.id}/time_entries`, { method: "POST", body: body });
        const saved = json && (json.time_entry || json);
        return { ok: true, id: saved && saved.id != null ? String(saved.id) : "", timeSpent: body.time_spent };
      } catch (err) {
        api.log("add-time-entry failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Looks up an agent by email (for a plugin that asks which agent you are;
    // current-agent below finds the key's own agent through /agents/me).
    api.handle("find-agent", async function (data) {
      const email = String((data && data.email) || "").trim().toLowerCase();
      if (!EMAIL_PATTERN.test(email)) return { error: "Enter the email address you sign in to Freshservice with." };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({ what: "Agent" }, conn), "/agents?email=" + encodeURIComponent(email));
        const agent = (Array.isArray(json.agents) ? json.agents : []).map(formatAgent).find(Boolean);
        if (!agent) return { error: "No Freshservice agent has the email " + email + "." };
        return { agent };
      } catch (err) {
        api.log("find-agent failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // Lists the tickets matching a filter query (see count-tickets), newest
    // pages first as Freshservice returns them, up to maxPages pages of 30.
    api.handle("filter-tickets", async function (data) {
      const built = buildFilterQuery(data && data.query, data && data.vars);
      if (built.error) return built;
      const conn = connection();
      if (conn.error) return conn;
      const maxPages = Math.min(Math.max(parseInt(data && data.maxPages, 10) || 1, 1), MAX_FILTER_PAGES);
      const what = Object.assign({ what: "Ticket filter" }, conn);
      const q = encodeURIComponent("\"" + built.query + "\"");
      try {
        const tickets = [];
        let total = 0;
        for (let page = 1; page <= maxPages; page++) {
          const json = await apiGet(what, "/tickets/filter?query=" + q + "&page=" + page);
          const batch = Array.isArray(json.tickets) ? json.tickets : [];
          if (typeof json.total === "number") total = json.total;
          tickets.push(...batch.map(formatTicketSummary).filter(Boolean));
          if (batch.length < FILTER_PAGE_SIZE || tickets.length >= total) break;
        }
        return { tickets, total: Math.max(total, tickets.length), query: built.query };
      } catch (err) {
        api.log("filter-tickets failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // A ticket's replies and notes, oldest first, each cut to a short snippet.
    api.handle("get-conversations", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { error: "Invalid ticket ID." };
      const conn = connection();
      if (conn.error) return conn;
      try {
        const list = await fetchConversations(conn, ticketId);
        return {
          ticketId,
          conversations: list.map(formatConversation).filter(Boolean)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        };
      } catch (err) {
        api.log("get-conversations failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // ---- Ticket search ----

    // Recently updated tickets, newest first, per domain and day window.
    let scanCache = null; // { domain, days, at, tickets, full }
    async function recentTickets(conn, days) {
      const now = Date.now();
      if (scanCache && scanCache.domain === conn.domain && scanCache.days === days && now - scanCache.at < SCAN_CACHE_MS) {
        return scanCache;
      }
      const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
      const what = Object.assign({}, conn, { what: "Ticket list" });
      const tickets = [];
      let full = false;
      for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
        const json = await apiGet(what, "/tickets?updated_since=" + encodeURIComponent(since) +
          "&per_page=" + SCAN_PER_PAGE + "&page=" + page);
        const batch = Array.isArray(json.tickets) ? json.tickets : [];
        tickets.push(...batch.map(formatTicketSummary).filter(Boolean));
        if (batch.length < SCAN_PER_PAGE) break;
        if (page === MAX_SCAN_PAGES) full = true;
      }
      scanCache = { domain: conn.domain, days, at: now, tickets, full };
      return scanCache;
    }

    // Requester (and agent) names by id, so results can say who raised each ticket.
    const peopleCache = new Map(); // "domain:id" → { name, email } | null
    async function lookUpPerson(conn, id) {
      const cacheKey = conn.domain + ":" + id;
      if (peopleCache.has(cacheKey)) return peopleCache.get(cacheKey);
      let person = null;
      for (const [path, field] of [["/requesters/", "requester"], ["/agents/", "agent"]]) {
        try {
          const json = await apiGet(Object.assign({}, conn, { what: "Requester" }), path + id);
          person = formatPerson(json && json[field]);
          if (person) break;
        } catch (err) {
          // Not a requester: it may be an agent. Anything else: give up on this one.
          if (!err || err.status !== 404) break;
        }
      }
      if (peopleCache.size > 2000) peopleCache.clear();
      peopleCache.set(cacheKey, person);
      return person;
    }

    async function ticketById(conn, id) {
      try {
        const json = await apiGet(Object.assign({}, conn, { what: "Ticket" }), "/tickets/" + id + "?include=requester");
        const t = json && json.ticket;
        const summary = formatTicketSummary(t);
        if (!summary) return [];
        const person = formatPerson(t.requester);
        if (person && summary.requesterId) peopleCache.set(conn.domain + ":" + summary.requesterId, person);
        return [summary];
      } catch (err) {
        if (err && err.status === 404) return [];
        throw err;
      }
    }

    // People whose name or email starts with the first word, narrowed to those
    // matching every word, then their tickets through the ticket filter.
    async function ticketsByRequester(conn, parsed) {
      const people = [];
      if (parsed.requesterQuery) {
        const json = await apiGet(Object.assign({}, conn, { what: "Requester search" }),
          "/requesters?query=" + encodeURIComponent("\"" + parsed.requesterQuery + "\"") + "&include_agents=true");
        const list = Array.isArray(json.requesters) ? json.requesters : [];
        for (const r of list) {
          const person = formatPerson(r);
          if (person && isId(r.id) && personMatches(person, parsed.words)) {
            peopleCache.set(conn.domain + ":" + r.id, person);
            people.push(r.id);
          }
          if (people.length >= MAX_MATCHED_REQUESTERS) break;
        }
      }
      const clauses = people.map((id) => "requester_id:" + id);
      if (parsed.email) clauses.push("email:'" + parsed.email + "'");
      if (!clauses.length) return { tickets: [], people: 0 };
      const json = await apiGet(Object.assign({}, conn, { what: "Ticket filter" }),
        "/tickets/filter?query=" + encodeURIComponent("\"" + clauses.join(" OR ") + "\"") + "&page=1");
      const tickets = (Array.isArray(json.tickets) ? json.tickets : []).map(formatTicketSummary).filter(Boolean);
      return { tickets, people: people.length };
    }

    // Searches tickets by number, subject or requester. Each part runs on its
    // own, so one failing (say the requester filter) still returns the others.
    api.handle("search-tickets", async function (data) {
      const parsed = parseTicketSearch(data && data.term);
      if (parsed.empty) return { tickets: [] };
      if (parsed.error) return parsed;
      const conn = connection();
      if (conn.error) return conn;
      const days = TICKET_SEARCH_DAY_CHOICES.includes(Number(data && data.days)) ? Number(data.days) : DEFAULT_TICKET_SEARCH_DAYS;

      const [byId, byRequester, scan] = await Promise.allSettled([
        parsed.id ? ticketById(conn, parsed.id) : Promise.resolve([]),
        parsed.requesterQuery || parsed.email ? ticketsByRequester(conn, parsed) : Promise.resolve({ tickets: [] }),
        parsed.words.length ? recentTickets(conn, days) : Promise.resolve(null),
      ]);
      // Only the parts that had something to search for count.
      const ran = [
        parsed.id ? byId : null,
        parsed.requesterQuery || parsed.email ? byRequester : null,
        parsed.words.length ? scan : null,
      ].filter(Boolean);
      const failures = ran.filter((r) => r.status === "rejected").map((r) => r.reason);
      failures.forEach((err) => api.log("search-tickets part failed:", err && err.message));
      if (failures.length && failures.length === ran.length) {
        return { error: (failures[0] && failures[0].message) || "Ticket search failed." };
      }

      const subjectHits = scan.status === "fulfilled" && scan.value
        ? scan.value.tickets.filter((t) => subjectMatches(t.subject, parsed.words)) : [];
      const merged = mergeTicketResults([
        { tickets: byId.status === "fulfilled" ? byId.value : [], match: "number" },
        { tickets: byRequester.status === "fulfilled" ? byRequester.value.tickets : [], match: "requester" },
        { tickets: subjectHits, match: "subject" },
      ], MAX_TICKET_SEARCH_RESULTS);

      // Fill in requester names, looking up at most a handful of unknown people.
      const unknown = [...new Set(merged.map((t) => t.requesterId).filter((id) => id && !peopleCache.has(conn.domain + ":" + id)))]
        .slice(0, MAX_REQUESTER_LOOKUPS);
      const [labels] = await Promise.all([
        fieldLabels(conn),
        ...unknown.map((id) => lookUpPerson(conn, id).catch(() => null)),
      ]);
      const tickets = merged.map((t) => {
        const person = t.requesterId ? peopleCache.get(conn.domain + ":" + t.requesterId) : null;
        return Object.assign({}, t, {
          statusLabel: labels.status[t.status] || "",
          priorityLabel: labels.priority[t.priority] || "",
          requester: person ? person.name : "",
          requesterEmail: person ? person.email : "",
        });
      });

      const warnings = [];
      if (byRequester.status === "rejected") warnings.push("Couldn't search requesters: " + byRequester.reason.message);
      if (scan.status === "rejected") warnings.push("Couldn't search subjects: " + scan.reason.message);
      const scanned = scan.status === "fulfilled" && scan.value ? scan.value : null;
      return {
        tickets,
        domain: conn.domain,
        accountHosts: accountHosts(conn.domain, api.getSettings()),
        days,
        scanned: scanned ? scanned.tickets.length : 0,
        scanFull: scanned ? scanned.full : false,
        warnings,
      };
    });

    // ===== Quick actions (status, priority, group, agent) =====
    //
    // Used by the Quick Actions plugin through the site adapter's ticketActions.
    // The choices (statuses incl. custom ones, agents, groups) are cached per
    // domain for a few minutes; data.force refreshes them.
    const optionsCache = new Map(); // keyCacheId → { at, value }

    async function listAll(conn, path, key, maxPages) {
      const all = [];
      for (let page = 1; page <= maxPages; page++) {
        const sep = path.includes("?") ? "&" : "?";
        const json = await apiGet(conn, `${path}${sep}per_page=100&page=${page}`);
        const batch = Array.isArray(json[key]) ? json[key] : [];
        all.push(...batch);
        if (batch.length < 100) break;
      }
      return all;
    }

    function checkHost(data, conn) {
      const host = data && typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && !sameInstance(host, conn.domain, api.getSettings())) {
        return { skipped: true, error: `The open page (${host}) isn't the configured Freshservice domain (${conn.domain}).` };
      }
      return null;
    }

    api.handle("get-ticket-options", async function (data) {
      const conn = connection();
      if (conn.error) return conn;
      const cached = optionsCache.get(keyCacheId(conn));
      if (cached && !(data && data.force) && Date.now() - cached.at < ACTION_OPTIONS_CACHE_MS) return cached.value;
      const [fields, agents, groups, me] = await Promise.allSettled([
        apiGet(Object.assign({}, conn, { what: "Ticket fields" }), "/ticket_form_fields"),
        listAll(Object.assign({}, conn, { what: "Agent list" }), "/agents?active=true", "agents", MAX_AGENT_PAGES),
        listAll(Object.assign({}, conn, { what: "Group list" }), "/groups", "groups", MAX_GROUP_PAGES),
        currentAgentId(conn),
      ]);
      const warnings = [];
      if (agents.status === "rejected") warnings.push("Couldn't list agents: " + agents.reason.message);
      if (groups.status === "rejected") warnings.push("Couldn't list groups: " + groups.reason.message);
      warnings.forEach((w) => api.log("get-ticket-options:", w));
      const choices = fields.status === "fulfilled" ? fieldChoices(fields.value) : {};
      if (fields.status === "fulfilled") labelsCache.set(conn.domain, { at: Date.now(), value: choicesToLabels(choices) });
      const value = {
        statuses: choices.status && choices.status.length ? choices.status : labelsToChoices(STATUS_LABELS),
        priorities: choices.priority && choices.priority.length ? choices.priority : labelsToChoices(PRIORITY_LABELS),
        agents: agents.status === "fulfilled" ? agents.value.map(formatAgent).filter(Boolean).sort(byName) : [],
        groups: groups.status === "fulfilled" ? groups.value.map(formatGroup).filter(Boolean).sort(byName) : [],
        me: me.status === "fulfilled" ? Number(me.value) : null,
        warnings,
      };
      if (!warnings.length) optionsCache.set(keyCacheId(conn), { at: Date.now(), value });
      return value;
    });

    api.handle("get-ticket-state", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "Quick actions work on tickets only." };
      const conn = connection();
      if (conn.error) return conn;
      const wrongHost = checkHost(data, conn);
      if (wrongHost) return wrongHost;
      try {
        const json = await apiGet(Object.assign({}, conn, { what: "Ticket" }), "/tickets/" + ticketId);
        const state = formatTicketState(json && json.ticket);
        return state ? { ticket: state } : { error: "Freshservice returned no ticket." };
      } catch (err) {
        api.log("get-ticket-state failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // data: { ticketId, host?, changes: { status?, priority?, groupId?, agentId? } }
    // agentId may be null (unassign) or "me" (the API key's agent).
    api.handle("update-ticket", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { error: "Quick actions work on tickets only." };
      const conn = connection();
      if (conn.error) return conn;
      const wrongHost = checkHost(data, conn);
      if (wrongHost) return wrongHost;
      try {
        const changes = Object.assign({}, data && data.changes);
        if (changes.agentId === "me") changes.agentId = Number(await currentAgentId(conn));
        const built = buildTicketUpdate(changes);
        if (built.error) return built;
        const json = await apiRequest(Object.assign({}, conn, { what: "Ticket update" }),
          "/tickets/" + ticketId, { method: "PUT", body: built.body });
        const state = formatTicketState(json && json.ticket);
        return { ok: true, ticket: state };
      } catch (err) {
        api.log("update-ticket failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // A short preview of a ticket for a hover card (Ticket Search, Recent
    // Tickets): status, priority, requester, agent and the latest reply or note.
    api.handle("preview-ticket", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "Only tickets can be previewed." };
      const conn = connection();
      if (conn.error) return conn;
      const host = data && typeof data.host === "string" ? data.host.toLowerCase() : "";
      if (host && !sameInstance(host, conn.domain, api.getSettings())) {
        return { skipped: true, error: `This ticket is on ${host}, not the configured Freshservice domain (${conn.domain}).` };
      }
      try {
        const [ticketJson, conversations] = await Promise.all([
          apiGet(Object.assign({}, conn, { what: "Ticket" }), `/tickets/${ticketId}?include=requester`),
          fetchConversations(conn, ticketId),
        ]);
        const ticket = (ticketJson && ticketJson.ticket) || {};
        const last = latestConversation(conversations);
        const [agent, author, labels] = await Promise.all([
          isId(ticket.responder_id) ? lookUpPerson(conn, ticket.responder_id).catch(() => null) : null,
          last && !last.incoming && isId(last.user_id) ? lookUpPerson(conn, last.user_id).catch(() => null) : null,
          fieldLabels(conn),
        ]);
        return { preview: formatTicketPreview(ticket, last, { agent, author }, labels) };
      } catch (err) {
        if (err && err.status === 404) return { error: "Ticket #" + ticketId + " wasn't found (it may have been deleted)." };
        api.log("preview-ticket failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // The hosts that are the configured API account, for plugins that compare a
    // tab's host with it (the API domain and, with an alias set up, its pair).
    api.handle("account-hosts", async function () {
      const conn = connection();
      if (conn.error) return conn;
      return { domain: conn.domain, hosts: accountHosts(conn.domain, api.getSettings()) };
    });

    // The agent the API key belongs to (/agents/me), so a plugin can tell which
    // tickets are "mine" without asking for an email address.
    api.handle("current-agent", async function () {
      const conn = connection();
      if (conn.error) return conn;
      try {
        const json = await apiGet(Object.assign({}, conn, { what: "Agent" }), "/agents/me");
        const agent = formatAgent(json && json.agent);
        if (!agent) return { error: "Freshservice didn't say which agent the API key belongs to." };
        agentIdByKey.set(keyCacheId(conn), agent.id);
        return { agent };
      } catch (err) {
        api.log("current-agent failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // ===== SLA Countdown =====
    //
    // A ticket's due times (first response and resolution) and whether it has
    // had its first response yet (?include=stats), for the SLA Countdown plugin
    // through the site adapter's ticketSla part.
    api.handle("ticket-sla", async function (data) {
      const ticketId = String((data && data.ticketId) || "");
      if (!/^\d{1,12}$/.test(ticketId)) return { skipped: true, error: "SLA times are read for tickets only." };
      const conn = connection();
      if (conn.error) return conn;
      const wrongHost = checkHost(data, conn);
      if (wrongHost) return wrongHost;
      try {
        const [json, labels] = await Promise.all([
          apiGet(Object.assign({}, conn, { what: "Ticket" }), "/tickets/" + ticketId + "?include=stats"),
          fieldLabels(conn),
        ]);
        const t = json && json.ticket;
        if (t && isId(t.id)) rememberSlaStats(conn, t);
        const sla = formatTicketSla(t, labels);
        return sla ? { ticket: sla } : { error: "Freshservice returned no ticket." };
      } catch (err) {
        if (err && err.status === 404) return { error: "Ticket #" + ticketId + " wasn't found (it may have been deleted)." };
        api.log("ticket-sla failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // domain|ticket id → { updatedAt, firstRespondedAt, at }
    const slaStatsCache = new Map();
    function rememberSlaStats(conn, t) {
      const stats = t.stats && typeof t.stats === "object" ? t.stats : {};
      slaStatsCache.set(conn.domain + "|" + t.id, {
        updatedAt: typeof t.updated_at === "string" ? t.updated_at : "",
        firstRespondedAt: typeof stats.first_responded_at === "string" ? stats.first_responded_at : "",
        at: Date.now(),
      });
      if (slaStatsCache.size > 500) slaStatsCache.delete(slaStatsCache.keys().next().value);
    }
    function cachedSlaStats(conn, t) {
      const hit = slaStatsCache.get(conn.domain + "|" + t.id);
      if (!hit || hit.updatedAt !== t.updated_at || Date.now() - hit.at > SLA_STATS_CACHE_MS) return null;
      return { first_responded_at: hit.firstRespondedAt || null };
    }

    // The open tickets assigned to the API key's agent, with due times, soonest
    // first. Tickets still waiting on a first response get their stats read
    // (cached until the ticket changes), so a response already sent isn't
    // counted down.
    api.handle("my-sla-tickets", async function () {
      const conn = connection();
      if (conn.error) return conn;
      try {
        const me = Number(await currentAgentId(conn));
        const labels = await fieldLabels(conn);
        const built = buildFilterQuery("agent_id:" + me + " AND " + slaOpenStatusQuery(labels));
        if (built.error) return built;
        const what = Object.assign({ what: "Ticket filter" }, conn);
        const q = encodeURIComponent("\"" + built.query + "\"");
        const raw = [];
        let total = 0;
        for (let page = 1; page <= MAX_SLA_PAGES; page++) {
          const json = await apiGet(what, "/tickets/filter?query=" + q + "&page=" + page);
          const batch = Array.isArray(json.tickets) ? json.tickets.filter((t) => t && isId(t.id)) : [];
          if (typeof json.total === "number") total = json.total;
          raw.push(...batch);
          if (batch.length < FILTER_PAGE_SIZE || raw.length >= total) break;
        }
        // Which tickets need their first response time: a response due time,
        // a running clock, and nothing cached for this version of the ticket.
        const warnings = [];
        const needStats = [];
        for (const t of raw) {
          const cached = cachedSlaStats(conn, t);
          if (cached) { t.stats = cached; continue; }
          const sla = formatTicketSla(t, labels);
          if (sla && sla.frDueBy && sla.state === "running") needStats.push(t);
        }
        needStats.sort((a, b) => String(a.fr_due_by).localeCompare(String(b.fr_due_by)));
        const lookups = needStats.slice(0, MAX_SLA_STATS_LOOKUPS);
        if (needStats.length > lookups.length) {
          warnings.push("First responses were checked for the " + lookups.length + " tickets due soonest only.");
        }
        let failed = 0;
        for (let i = 0; i < lookups.length; i += SLA_STATS_CONCURRENCY) {
          await Promise.all(lookups.slice(i, i + SLA_STATS_CONCURRENCY).map(async (t) => {
            try {
              const json = await apiGet(Object.assign({}, conn, { what: "Ticket" }), "/tickets/" + t.id + "?include=stats");
              const full = json && json.ticket;
              if (full && isId(full.id)) {
                rememberSlaStats(conn, full);
                t.stats = full.stats || {};
              }
            } catch { failed++; }
          }));
        }
        if (failed) warnings.push("Couldn't check the first response on " + failed + " ticket" + (failed === 1 ? "" : "s") + ".");
        const tickets = raw.map((t) => formatTicketSla(t, labels)).filter(Boolean);
        if (total > raw.length) {
          warnings.push("Showing the first " + raw.length + " of your " + total + " open tickets.");
        }
        return {
          tickets,
          total: Math.max(total, tickets.length),
          domain: conn.domain,
          accountHosts: accountHosts(conn.domain, api.getSettings()),
          warnings,
        };
      } catch (err) {
        api.log("my-sla-tickets failed:", err.message);
        return { error: err.message || String(err) };
      }
    });

    // ===== AI Assistant lookups =====
    //
    // The AI Assistant plugin asks for the list of lookups (assistant-tools)
    // and runs them one at a time (assistant-lookup). All of them are GETs to
    // the configured domain; see assistant-tools.js.
    api.handle("assistant-tools", async function () {
      const conn = connection();
      return {
        site: "Freshservice",
        tools: assistantTools.TOOLS,
        ready: !conn.error,
        error: conn.error || undefined,
        linkBase: conn.error ? "" : "https://" + conn.domain + "/a/tickets/",
      };
    });

    api.handle("assistant-lookup", async function (data) {
      const conn = connection();
      if (conn.error) return { error: conn.error, content: "Error: " + conn.error };
      const ctx = {
        domain: conn.domain,
        get: (what, pathAndQuery) => apiGet(Object.assign({}, conn, { what }), pathAndQuery),
        labels: () => fieldLabels(conn),
        myAgentId: () => currentAgentId(conn),
        openStatusQuery: async () => slaOpenStatusQuery(await fieldLabels(conn)),
        ticketText: async (id) => {
          const [ticketJson, conversations, labels] = await Promise.all([
            apiGet(conn, `/tickets/${id}?include=requester`),
            fetchConversations(conn, String(id)),
            fieldLabels(conn),
          ]);
          const ticket = ticketJson.ticket || {};
          return assistantTicketHeader(ticket) + formatTicketText(ticket, conversations, labels);
        },
      };
      const res = await assistantTools.lookup(ctx, data && data.tool, data && data.args);
      if (res.error) api.log("assistant-lookup " + String(data && data.tool).substring(0, 40) + " failed:", res.error);
      return res;
    });

    api.handle("test-connection", async function () {
      const conn = connection();
      if (conn.error) return { error: conn.error };
      try {
        await apiGet(conn, "/tickets?per_page=1");
        return { ok: true, domain: conn.domain };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });
  },

  // Exported for tests.
  normalizeDomain,
  aliasRedirects,
  sameInstance,
  accountHosts,
  customSiteHosts,
  choicesToLabels,
  keyHost,
  buildFilterQuery,
  buildTimeEntry,
  formatTimeSpent,
  formatTicketText,
  formatArticle,
  formatAgent,
  formatTicketSummary,
  formatConversation,
  latestConversation,
  formatTicketPreview,
  ticketFields,
  parseTicketSearch,
  subjectMatches,
  personMatches,
  formatPerson,
  mergeTicketResults,
  fieldChoices,
  formatTicketState,
  buildTicketUpdate,
  formatTicketSla,
  slaOpenStatusQuery,
  assistantTicketHeader,
};

// The ids get_ticket adds above the ticket text, so the AI Assistant can look
// up the agent, group or requester behind a ticket.
function assistantTicketHeader(ticket) {
  const ids = [];
  if (isId(ticket.requester_id)) ids.push("requester_id " + ticket.requester_id);
  if (isId(ticket.responder_id)) ids.push("agent_id " + ticket.responder_id);
  if (isId(ticket.group_id)) ids.push("group_id " + ticket.group_id);
  if (isId(ticket.department_id)) ids.push("department_id " + ticket.department_id);
  if (typeof ticket.type === "string" && ticket.type) ids.push("type " + ticket.type.substring(0, 50));
  if (typeof ticket.category === "string" && ticket.category) ids.push("category " + ticket.category.substring(0, 100));
  if (typeof ticket.due_by === "string" && ticket.due_by) ids.push("due_by " + ticket.due_by);
  if (typeof ticket.updated_at === "string" && ticket.updated_at) ids.push("updated_at " + ticket.updated_at);
  if (Array.isArray(ticket.tags) && ticket.tags.length) ids.push("tags " + ticket.tags.slice(0, 10).map(String).join(", ").substring(0, 200));
  return ids.length ? "[" + ids.join(" | ") + "]\n" : "";
}

// What the user typed in ticket search → the parts each kind of search uses:
//   id             a ticket number ("123", "#123", "INC-123", "SR-123")
//   words          lowercase words every subject (or requester) must contain
//   email          an email address, matched exactly by the ticket filter
//   requesterQuery a requester filter ("starts with" on name and email) for
//                  the first word, with quotes and other syntax stripped out
// Returns { empty: true } for nothing typed, or { error } when too long.
function parseTicketSearch(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return { empty: true };
  if (text.length > MAX_TICKET_SEARCH_CHARS) return { error: `Search for ${MAX_TICKET_SEARCH_CHARS} characters or fewer.` };
  const idMatch = /^#?(?:(?:INC|SR|FS)-?)?(\d{1,12})$/i.exec(text);
  const id = idMatch ? String(Number(idMatch[1])) : "";
  const words = id ? [] : text.toLowerCase().split(" ").filter(Boolean);
  const email = EMAIL_PATTERN.test(text) && !/[',\\]/.test(text) ? text.toLowerCase() : "";
  const first = (words[0] || "").replace(/[^\p{L}\p{N}@._+-]/gu, "");
  const requesterQuery = !id && first.length >= 2 ? "~[first_name|last_name|primary_email]:'" + first + "'" : "";
  return { text, id, words, email, requesterQuery };
}

function subjectMatches(subject, words) {
  const s = String(subject || "").toLowerCase();
  return words.length > 0 && words.every((w) => s.includes(w));
}

function personMatches(person, words) {
  const hay = (person.name + " " + person.email).toLowerCase();
  return words.every((w) => hay.includes(w));
}

// A requester or agent → { name, email }, or null.
function formatPerson(p) {
  if (!p || typeof p !== "object") return null;
  const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().substring(0, 200) : "");
  const name = clean(p.name) || [clean(p.first_name), clean(p.last_name)].filter(Boolean).join(" ");
  const email = clean(p.primary_email) || clean(p.email);
  return name || email ? { name: name || email, email } : null;
}

// Merges lists of ticket summaries, one per kind of match, into one list
// without repeats: number matches first, then the rest newest-updated first.
// Each ticket says which kinds matched it (matches: ["requester", "subject"]).
function mergeTicketResults(groups, max) {
  const byId = new Map();
  for (const g of groups) {
    for (const t of g.tickets || []) {
      const hit = byId.get(t.id);
      if (hit) { if (!hit.matches.includes(g.match)) hit.matches.push(g.match); }
      else byId.set(t.id, Object.assign({}, t, { matches: [g.match] }));
    }
  }
  return [...byId.values()].sort((a, b) => {
    const an = a.matches.includes("number") ? 0 : 1;
    const bn = b.matches.includes("number") ? 0 : 1;
    if (an !== bn) return an - bn;
    return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
  }).slice(0, max || MAX_TICKET_SEARCH_RESULTS);
}

// The bits of a ticket that reply placeholders use.
function ticketFields(ticket) {
  const r = ticket && ticket.requester && typeof ticket.requester === "object" ? ticket.requester : {};
  const clean = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().substring(0, 200) : "");
  const first = clean(r.first_name);
  const name = clean(r.name) || [first, clean(r.last_name)].filter(Boolean).join(" ");
  return {
    subject: clean(ticket && ticket.subject),
    requester: name,
    requesterFirstName: first || (name ? name.split(" ")[0] : ""),
  };
}

// Accepts "acme.freshservice.com", "https://acme.freshservice.com/a/tickets/1", etc.
// and returns the lowercase hostname, or null if it isn't a plain https host.
function normalizeDomain(raw) {
  let value = String(raw || "").trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  return HOSTNAME_PATTERN.test(host) ? host : null;
}

function isFreshworksHost(host) {
  return FRESHWORKS_HOSTNAME_PATTERN.test(String(host || ""));
}

// [{ from, to }] for api.setHostRedirects: the alias host to the Freshservice host,
// when both are set and valid, else [].
function aliasRedirects(settings) {
  const from = normalizeDomain(settings && settings.fsAliasHost);
  const to = normalizeDomain(settings && settings.fsAliasTarget);
  if (!from || !to || from === to || isFreshworksHost(from) || !isFreshworksHost(to)) return [];
  return [{ from, to }];
}

// True when a page host and the API domain are the same Freshservice account:
// the same host, or the alias host and the Freshservice host it redirects to
// (in either order — with the alias on, tabs sit on the Freshservice host while
// the API domain may still be the alias, or the other way round).
function sameInstance(host, domain, settings) {
  const h = String(host || "").toLowerCase();
  return !!h && accountHosts(domain, settings).includes(h);
}

// The page hosts that are the same Freshservice account as the API domain: the
// domain itself and, when it is one end of the alias pair, the other end. The
// one place this is worked out; other plugins ask through "account-hosts".
function accountHosts(domain, settings) {
  const d = String(domain || "").toLowerCase();
  if (!d) return [];
  const pair = aliasRedirects(settings)[0];
  if (pair && d === pair.from) return [d, pair.to];
  if (pair && d === pair.to) return [d, pair.from];
  return [d];
}

// Hosts for api.setSiteHosts: the API domain when it isn't a Freshservice host
// already (a company's own name for the instance). The alias host is left out:
// its page loads are redirected, and a site host can't be redirected.
function customSiteHosts(settings) {
  const d = normalizeDomain(settings && settings.fsApiDomain);
  if (!d || isFreshworksHost(d)) return [];
  const pair = aliasRedirects(settings)[0];
  return pair && pair.from === d ? [] : [d];
}

// fieldChoices() → { status: { 2: "Open", … }, priority: { … } }, with the
// standard names for any list that came back empty.
function choicesToLabels(choices) {
  const toMap = (list, fallback) => {
    if (!Array.isArray(list) || !list.length) return Object.assign({}, fallback);
    const out = {};
    for (const c of list) out[c.value] = c.label;
    return out;
  };
  return {
    status: toMap(choices && choices.status, STATUS_LABELS),
    priority: toMap(choices && choices.priority, PRIORITY_LABELS),
  };
}

// The domain a saved API key belongs to, or "" when there is no key or no domain
// yet. Keys saved before the tie was recorded belong to the domain saved with them.
function keyHost(settings) {
  if (!settings || !(settings.fsApiKeyEncrypted || settings.fsApiKey)) return "";
  if (typeof settings.fsApiKeyHost === "string" && settings.fsApiKeyHost) return settings.fsApiKeyHost;
  return normalizeDomain(settings.fsApiDomain || "") || "";
}

// Checks a ticket filter query and fills in its {name} placeholders from vars.
// Returns { query } or { error }. Double quotes aren't allowed because the
// whole query is sent wrapped in them.
function buildFilterQuery(raw, vars) {
  const template = String(raw || "").replace(/\s+/g, " ").trim();
  if (!template) return { error: "Enter a ticket filter query." };
  if (template.includes("\"")) return { error: "Use single quotes in the query, not double quotes." };
  const values = vars && typeof vars === "object" ? vars : {};
  let unknown = null;
  const query = template.replace(/\{([a-zA-Z]+)\}/g, function (whole, name) {
    const v = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (typeof v === "string" && DATE_VAR_PATTERN.test(v)) return v;
    unknown = unknown || whole;
    return whole;
  });
  if (unknown) return { error: `Unknown placeholder ${unknown}. Use {today}, {weekStart} or {monthStart}.` };
  if (query.length > MAX_FILTER_QUERY_CHARS) return { error: `The query is longer than ${MAX_FILTER_QUERY_CHARS} characters.` };
  return { query };
}

// Record kinds the API takes time entries on, and their URL collection.
const TIME_ENTRY_COLLECTIONS = { ticket: "tickets", change: "changes", problem: "problems", release: "releases" };
const MAX_TIME_ENTRY_MINUTES = 24 * 60;
const MAX_TIME_ENTRY_NOTE_CHARS = 4000;

// 65 → "01:05", the "hh:mm" form Freshservice's time_spent takes.
function formatTimeSpent(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}

// Checks a time entry request from the renderer.
// Returns { collection, id, body } or { error }.
function buildTimeEntry(data) {
  const d = data && typeof data === "object" ? data : {};
  const kind = typeof d.kind === "string" ? d.kind.toLowerCase() : "ticket";
  const collection = Object.prototype.hasOwnProperty.call(TIME_ENTRY_COLLECTIONS, kind) ? TIME_ENTRY_COLLECTIONS[kind] : null;
  if (!collection) return { error: "Time can only be logged on tickets, changes, problems and releases." };
  const id = String(d.id == null ? "" : d.id);
  if (!/^\d{1,12}$/.test(id)) return { error: "Open a ticket to log time on." };
  const minutes = Number(d.minutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIME_ENTRY_MINUTES) {
    return { error: "The time must be between 1 minute and 24 hours." };
  }
  const body = { time_spent: formatTimeSpent(minutes) };
  if (typeof d.note === "string" && d.note.trim()) body.note = d.note.trim().substring(0, MAX_TIME_ENTRY_NOTE_CHARS);
  if (typeof d.billable === "boolean") body.billable = d.billable;
  return { collection, id, body };
}

// The field errors in a Freshservice 400 reply, e.g. "(agent_id: It should be a/an Integer)".
function describeValidationErrors(json) {
  const list = json && Array.isArray(json.errors) ? json.errors : [];
  const parts = list.slice(0, 3).map(function (e) {
    const field = e && typeof e.field === "string" ? e.field : "";
    const msg = e && typeof e.message === "string" ? e.message : "";
    return [field, msg].filter(Boolean).join(": ").substring(0, 200);
  }).filter(Boolean);
  return parts.length ? "(" + parts.join("; ") + ")" : "";
}

function describeHttpError(resp, what) {
  const noun = what || "Ticket";
  switch (resp.status) {
    case 400:
      if (what === "Ticket filter") return "Freshservice didn't accept the filter query (400). Check the field names and quotes.";
      if (what === "Time entry") return "Freshservice didn't accept the time entry (400).";
      if (what === "Ticket update") return "Freshservice didn't accept the change (400). A field the form requires may be empty.";
      return "Freshservice rejected the request (400).";
    case 401: return "Freshservice rejected the API key (401). Check it in Settings → Freshservice.";
    case 403:
      if (what === "Time entry") return "This API key's agent isn't allowed to add time entries to that record (403).";
      if (what === "Ticket update") return "This API key's agent isn't allowed to change that ticket (403).";
      return `This API key isn't allowed to view that ${noun.toLowerCase()} (403).`;
    case 404: return `${noun} not found in Freshservice (404).`;
    case 429: {
      const retry = resp.headers && typeof resp.headers.get === "function" ? resp.headers.get("retry-after") : null;
      return "Freshservice API rate limit reached (429)" + (retry ? `, retry in ${retry} seconds.` : ".");
    }
    default: return `Freshservice API error ${resp.status}.`;
  }
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bodyText(item, textField, htmlField) {
  const text = typeof item[textField] === "string" ? item[textField].trim() : "";
  return text || htmlToText(item[htmlField]);
}

// Reduces a Solutions article from the API to what the chat needs: plain text
// capped at maxChars and a link built only from the configured domain and the ID.
function formatArticle(a, domain, maxChars) {
  if (!a || typeof a !== "object") return null;
  const id = String(a.id || "");
  if (!/^\d{1,20}$/.test(id)) return null;
  const text = bodyText(a, "description_text", "description");
  return {
    id,
    title: typeof a.title === "string" && a.title.trim() ? a.title.trim().substring(0, 300) : "Article " + id,
    status: a.status === 1 ? "draft" : "published",
    updatedAt: typeof a.updated_at === "string" ? a.updated_at : "",
    url: domain ? `https://${domain}/support/solutions/articles/${id}` : "",
    text: text.substring(0, maxChars || MAX_ARTICLE_CHARS),
    truncated: text.length > (maxChars || MAX_ARTICLE_CHARS),
  };
}

function isId(v) {
  return Number.isSafeInteger(v) && v > 0;
}

function formatAgent(a) {
  if (!a || typeof a !== "object" || !isId(a.id)) return null;
  const name = [a.first_name, a.last_name].filter((p) => typeof p === "string" && p.trim()).join(" ").trim();
  return {
    id: a.id,
    name: name.substring(0, 200),
    email: typeof a.email === "string" ? a.email.substring(0, 254) : "",
  };
}

function formatTicketSummary(t) {
  if (!t || typeof t !== "object" || !isId(t.id)) return null;
  return {
    id: t.id,
    subject: typeof t.subject === "string" ? t.subject.substring(0, 300) : "",
    status: Number.isInteger(t.status) ? t.status : null,
    priority: Number.isInteger(t.priority) ? t.priority : null,
    responderId: isId(t.responder_id) ? t.responder_id : null,
    requesterId: isId(t.requester_id) ? t.requester_id : null,
    createdAt: typeof t.created_at === "string" ? t.created_at : "",
    updatedAt: typeof t.updated_at === "string" ? t.updated_at : "",
  };
}

function formatConversation(c) {
  if (!c || typeof c !== "object" || !isId(c.id)) return null;
  const text = bodyText(c, "body_text", "body").replace(/\s+/g, " ").trim();
  return {
    id: c.id,
    userId: isId(c.user_id) ? c.user_id : null,
    incoming: c.incoming === true,
    private: c.private === true,
    fromEmail: typeof c.from_email === "string" ? c.from_email.substring(0, 254) : "",
    createdAt: typeof c.created_at === "string" ? c.created_at : "",
    snippet: text.substring(0, MAX_CONVERSATION_SNIPPET_CHARS),
  };
}

// The newest reply or note of a ticket's conversations (raw API objects), or null.
function latestConversation(conversations) {
  let best = null;
  for (const c of Array.isArray(conversations) ? conversations : []) {
    if (!c || typeof c !== "object" || typeof c.created_at !== "string") continue;
    if (!best || c.created_at.localeCompare(best.created_at) >= 0) best = c;
  }
  return best;
}

// A ticket from the API (with ?include=requester), its newest conversation and
// the people looked up for it → the fields a hover preview shows.
function formatTicketPreview(ticket, last, people, labels) {
  const names = labels || choicesToLabels({});
  const t = ticket && typeof ticket === "object" ? ticket : {};
  const p = people || {};
  const clean = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().substring(0, max || 200) : "");
  const requester = formatPerson(t.requester);
  const description = bodyText(t, "description_text", "description").replace(/\s+/g, " ").trim();
  let lastReply = null;
  if (last && typeof last === "object") {
    const conv = formatConversation(last);
    if (conv) {
      let from;
      if (conv.incoming) from = (requester && requester.name) || conv.fromEmail || "Requester";
      else from = (p.author && p.author.name) || conv.fromEmail || "Agent";
      lastReply = {
        type: conv.incoming ? "requester" : (conv.private ? "note" : "reply"),
        from: from.substring(0, 200),
        at: conv.createdAt,
        snippet: conv.snippet,
      };
    }
  }
  return {
    id: isId(t.id) ? t.id : null,
    subject: clean(t.subject, 300),
    status: names.status[t.status] || "",
    priority: names.priority[t.priority] || "",
    requester: requester ? requester.name : "",
    requesterEmail: requester ? requester.email : "",
    agent: p.agent && p.agent.name ? p.agent.name : "",
    createdAt: typeof t.created_at === "string" ? t.created_at : "",
    updatedAt: typeof t.updated_at === "string" ? t.updated_at : "",
    dueBy: typeof t.due_by === "string" ? t.due_by : "",
    description: description.substring(0, MAX_CONVERSATION_SNIPPET_CHARS),
    lastReply,
  };
}

function conversationLabel(c) {
  if (c.incoming) return "Message from requester";
  if (c.private) return "Private note";
  return "Reply / public note";
}

// Builds the plain-text view of a ticket that the AI features read: a header,
// the description, then each conversation in order, separated like the page scrape.
function formatTicketText(ticket, conversations, labels) {
  const names = labels || choicesToLabels({});
  const header = [];
  header.push(`Ticket #${ticket.id || ""}${ticket.subject ? ": " + ticket.subject : ""}`);
  const meta = [];
  if (names.status[ticket.status]) meta.push("Status: " + names.status[ticket.status]);
  if (names.priority[ticket.priority]) meta.push("Priority: " + names.priority[ticket.priority]);
  const r = ticket.requester;
  if (r && (r.name || r.first_name || r.email)) {
    const name = r.name || [r.first_name, r.last_name].filter(Boolean).join(" ");
    meta.push("Requester: " + [name, r.email ? `<${r.email}>` : ""].filter(Boolean).join(" "));
  }
  if (ticket.created_at) meta.push("Created: " + ticket.created_at);
  if (meta.length) header.push(meta.join(" | "));

  const parts = [header.join("\n")];
  const description = bodyText(ticket, "description_text", "description");
  if (description) parts.push("Description:\n" + description);

  const sorted = (Array.isArray(conversations) ? conversations : [])
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  for (const c of sorted) {
    const text = bodyText(c, "body_text", "body");
    if (!text) continue;
    parts.push(`[${conversationLabel(c)}${c.created_at ? ", " + c.created_at : ""}]\n${text}`);
  }
  return parts.join("\n\n---\n\n").substring(0, MAX_TEXT_CHARS);
}

// ===== Quick actions helpers =====

function labelsToChoices(labels) {
  return Object.keys(labels).map((k) => ({ value: Number(k), label: labels[k] }));
}

function byName(a, b) {
  return String(a.name || a.email).localeCompare(String(b.name || b.email), undefined, { sensitivity: "base" });
}

function formatGroup(g) {
  if (!g || typeof g !== "object" || !isId(g.id)) return null;
  const name = typeof g.name === "string" ? g.name.replace(/\s+/g, " ").trim().substring(0, 200) : "";
  return { id: g.id, name: name || "Group " + g.id };
}

// The status and priority choices from /ticket_form_fields, custom statuses
// included. Freshservice lists choices as [{ id, value }] (some accounts send
// a { "2": "Open" } or { "2": ["Open", "..."] } map instead); anything that
// isn't a whole-number choice with a name is skipped.
function fieldChoices(json) {
  const fields = json && Array.isArray(json.ticket_fields) ? json.ticket_fields : [];
  const out = {};
  for (const name of ["status", "priority"]) {
    const field = fields.find((f) => f && f.name === name);
    let raw = field ? field.choices : null;
    const list = [];
    if (raw && !Array.isArray(raw) && typeof raw === "object") {
      raw = Object.keys(raw).map((k) => ({ id: k, value: Array.isArray(raw[k]) ? raw[k][0] : raw[k] }));
    }
    for (const c of Array.isArray(raw) ? raw : []) {
      if (!c || typeof c !== "object") continue;
      const value = Number(c.id != null ? c.id : c.value);
      const label = typeof c.value === "string" ? c.value : (typeof c.label === "string" ? c.label : "");
      if (!Number.isInteger(value) || value < 1 || value > 100000 || !label.trim()) continue;
      if (list.some((x) => x.value === value)) continue;
      list.push({ value, label: label.replace(/\s+/g, " ").trim().substring(0, 100) });
    }
    out[name] = list;
  }
  return out;
}

// A ticket → what the quick actions show.
function formatTicketState(t) {
  if (!t || typeof t !== "object" || !isId(t.id)) return null;
  return {
    id: t.id,
    subject: typeof t.subject === "string" ? t.subject.substring(0, 300) : "",
    status: Number.isInteger(t.status) ? t.status : null,
    priority: Number.isInteger(t.priority) ? t.priority : null,
    agentId: isId(t.responder_id) ? t.responder_id : null,
    groupId: isId(t.group_id) ? t.group_id : null,
    updatedAt: typeof t.updated_at === "string" ? t.updated_at : "",
  };
}

// The ticket filter for "not resolved or closed", e.g.
// "(status:2 OR status:3 OR status:6 OR status:>6)". Freshservice's :< and :>
// include the number itself (status:<4 matches Resolved too), so a range
// like (status:<4 OR status:>5) matches every ticket, closed ones included.
// Instead each open status from the account's form is named, plus everything
// above the highest status known, for custom statuses the form didn't list
// (that range can't reach 4 or 5 whichever way the operator works).
function slaOpenStatusQuery(labels) {
  const names = (labels && labels.status) || STATUS_LABELS;
  const all = Object.keys(names).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const open = all
    .filter((n) => n !== 4 && n !== 5 && !/^(?:resolved|closed)$/i.test(String(names[n] || "")))
    .sort((a, b) => a - b);
  const top = Math.max(5, ...all);
  return "(" + open.map((n) => "status:" + n).concat("status:>" + top).join(" OR ") + ")";
}

// A ticket from the API (raw, with or without ?include=stats) → its SLA view
// for the SLA Countdown plugin. state is "done" (resolved or closed), "paused"
// (a status that normally stops the clock, by name) or "running". responded is
// true / false when the stats were read, null when they weren't.
function formatTicketSla(t, labels) {
  if (!t || typeof t !== "object" || !isId(t.id)) return null;
  const names = labels || choicesToLabels({});
  const status = Number.isInteger(t.status) ? t.status : null;
  const statusLabel = status != null && names.status[status] ? String(names.status[status]) : "";
  const time = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : "");
  const stats = t.stats && typeof t.stats === "object" ? t.stats : null;
  let state = "running";
  if (status === 4 || status === 5 || /^(?:resolved|closed)$/i.test(statusLabel)) state = "done";
  else if (status === 3 || SLA_PAUSED_LABEL_PATTERN.test(statusLabel)) state = "paused";
  return {
    id: t.id,
    subject: typeof t.subject === "string" ? t.subject.substring(0, 300) : "",
    status,
    statusLabel,
    priority: Number.isInteger(t.priority) ? t.priority : null,
    priorityLabel: Number.isInteger(t.priority) && names.priority[t.priority] ? String(names.priority[t.priority]) : "",
    state,
    frDueBy: time(t.fr_due_by),
    dueBy: time(t.due_by),
    frEscalated: t.fr_escalated === true,
    isEscalated: t.is_escalated === true,
    firstRespondedAt: stats ? time(stats.first_responded_at) : "",
    responded: stats ? !!time(stats.first_responded_at) : null,
    updatedAt: time(t.updated_at),
  };
}

// Checks the changes the renderer asked for. Returns { body } for PUT
// /tickets/{id}, or { error }. agentId / groupId null unassigns.
function buildTicketUpdate(changes) {
  const c = changes && typeof changes === "object" ? changes : {};
  const body = {};
  const whole = (v) => Number.isInteger(v) && v >= 1 && v <= 100000;
  if (c.status !== undefined) {
    if (!whole(c.status)) return { error: "That isn't a status Freshservice knows." };
    body.status = c.status;
  }
  if (c.priority !== undefined) {
    if (!whole(c.priority)) return { error: "That isn't a priority Freshservice knows." };
    body.priority = c.priority;
  }
  if (c.agentId !== undefined) {
    if (c.agentId !== null && !isId(c.agentId)) return { error: "That isn't an agent Freshservice knows." };
    body.responder_id = c.agentId;
  }
  if (c.groupId !== undefined) {
    if (c.groupId !== null && !isId(c.groupId)) return { error: "That isn't a group Freshservice knows." };
    body.group_id = c.groupId;
  }
  if (!Object.keys(body).length) return { error: "Nothing to change." };
  return { body };
}
