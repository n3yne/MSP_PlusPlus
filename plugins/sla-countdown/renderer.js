// SLA Countdown plugin — main window renderer
//
// Counts down to each ticket's SLA deadlines (first response, then resolution):
//   - a small badge on every tab that has a ticket open, and
//   - an ⏱ SLA tab in the side panel with the ticket in the active tab and a
//     list of your open tickets, soonest deadline first.
// Each countdown turns amber and then red as its deadline gets close (both
// thresholds are settings), and an in-app notification says when a ticket goes
// red or past due, so a breach doesn't creep up while you're in another tab.
//
// The due times come from the site plugin (its ticketSla adapter part;
// Freshservice reads them through its REST API), so this plugin knows nothing
// about any particular site. They are read again every few minutes (a
// setting) and when you switch to a ticket's tab; the countdown itself ticks
// locally every 30 seconds.
//
// The pure helpers at the top are exported for tests when loaded under Node.
/* global module */
(function () {
  "use strict";

  const TAB_ID = "sla-countdown";
  const MINUTE = 60 * 1000;
  const TICK_MS = 30 * 1000;
  const ACTIVATE_REFRESH_MS = MINUTE;
  const MAX_NOTIFY_SEPARATELY = 3;

  const DEFAULTS = { amber: 60, red: 15, refresh: 5 };

  // ==================== Pure helpers ====================

  function wholeSetting(v, fallback, min, max) {
    return Number.isInteger(v) && v >= min && v <= max ? v : fallback;
  }

  // The plugin's settings with defaults filled in. red is never above amber.
  function readSettings(s) {
    const o = s || {};
    const amber = wholeSetting(o.slaAmberMinutes, DEFAULTS.amber, 1, 24 * 60);
    const red = Math.min(wholeSetting(o.slaRedMinutes, DEFAULTS.red, 1, 24 * 60), amber);
    return {
      badges: o.slaTabBadges !== false,
      notify: o.slaNotify !== false,
      amber: amber,
      red: red,
      refresh: wholeSetting(o.slaRefreshMinutes, DEFAULTS.refresh, 1, 60),
    };
  }

  // The deadline that matters now for a ticket from the site's ticketSla part:
  //   { state: "done" } or { state: "paused" }, or
  //   { state: "running", kind: "response" | "resolution", due, left }
  // (due as epoch ms, left in ms, negative once past), or null when the
  // ticket has no due time. The first response counts until it has been sent;
  // when the site couldn't say (responded null) it counts while still ahead,
  // or once Freshservice has escalated it for a missed response.
  function nextDeadline(t, now) {
    if (!t || typeof t !== "object") return null;
    if (t.state === "done") return { state: "done" };
    if (t.state === "paused") return { state: "paused" };
    const fr = Date.parse(t.frDueBy || "");
    const res = Date.parse(t.dueBy || "");
    let response = false;
    if (!Number.isNaN(fr)) {
      if (t.responded === false) response = true;
      else if (t.responded == null) response = fr > now || t.frEscalated === true;
    }
    let kind = null;
    let due = NaN;
    if (response) { kind = "response"; due = fr; }
    if (!Number.isNaN(res) && (kind === null || res < due)) { kind = "resolution"; due = res; }
    if (kind === null) return null;
    return { state: "running", kind: kind, due: due, left: due - now };
  }

  // "ok" | "amber" | "red" | "overdue" for the time left, with the thresholds
  // in minutes.
  function urgency(left, amberMinutes, redMinutes) {
    if (left < 0) return "overdue";
    if (left <= redMinutes * MINUTE) return "red";
    if (left <= amberMinutes * MINUTE) return "amber";
    return "ok";
  }

  // A length of time, short: "<1m", "45m", "2h 05m", "3d 4h".
  function formatSpan(ms) {
    const minutes = Math.floor(Math.abs(ms) / MINUTE);
    if (minutes < 1) return "<1m";
    if (minutes < 60) return minutes + "m";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h " + String(minutes % 60).padStart(2, "0") + "m";
    return Math.floor(hours / 24) + "d " + (hours % 24) + "h";
  }

  // What the badge says: the time left, or how long it's been past due.
  function badgeText(d) {
    if (!d || d.state !== "running") return "";
    return (d.left < 0 ? "−" : "") + formatSpan(d.left);
  }

  function kindName(kind) {
    return kind === "response" ? "First response" : "Resolution";
  }

  // A due time as the user reads it: "3:45 PM" today, "Tue 9:00 AM" this week,
  // else "18 Nov 9:00 AM".
  function formatDue(due, now) {
    const d = new Date(due);
    const n = new Date(now);
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === n.toDateString()) return time;
    if (Math.abs(due - now) < 6 * 24 * 60 * MINUTE) return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
    return d.toLocaleDateString([], { day: "numeric", month: "short" }) + " " + time;
  }

  // "First response due in 45m (3:45 PM)", "Resolution overdue by 2h 05m (…)".
  function describeDeadline(d, now) {
    if (!d) return "No SLA due time";
    if (d.state === "done") return "Resolved";
    if (d.state === "paused") return "On hold (the SLA clock is stopped)";
    const when = formatDue(d.due, now);
    if (d.left < 0) return kindName(d.kind) + " overdue by " + formatSpan(d.left) + " (" + when + ")";
    return kindName(d.kind) + " due in " + formatSpan(d.left) + " (" + when + ")";
  }

  // Every deadline of a ticket, for a tooltip: one line each.
  function describeAll(t, now) {
    if (!t) return "";
    const lines = [];
    const fr = Date.parse(t.frDueBy || "");
    const res = Date.parse(t.dueBy || "");
    if (!Number.isNaN(fr)) {
      if (t.responded === true) lines.push("First response: sent");
      else lines.push("First response " + (fr < now ? "was due " : "due ") + formatDue(fr, now));
    }
    if (!Number.isNaN(res)) lines.push("Resolution " + (res < now ? "was due " : "due ") + formatDue(res, now));
    if (t.state === "paused") lines.push("On hold: " + (t.statusLabel || "the status") + " stops the SLA clock");
    return lines.join("\n");
  }

  // Sorts tickets for the list: running ones by deadline (most overdue first),
  // then those with no due time, then on hold. Returns [{ ticket, d }].
  function sortByDeadline(tickets, now) {
    const rank = function (d) {
      if (!d) return 1;
      if (d.state === "running") return 0;
      if (d.state === "paused") return 2;
      return 3;
    };
    return (tickets || [])
      .map(function (t) { return { ticket: t, d: nextDeadline(t, now) }; })
      .filter(function (x) { return !x.d || x.d.state !== "done"; })
      .sort(function (a, b) {
        const ra = rank(a.d);
        const rb = rank(b.d);
        if (ra !== rb) return ra - rb;
        if (ra === 0) return a.d.due - b.d.due;
        return String(a.ticket.id).localeCompare(String(b.ticket.id), undefined, { numeric: true });
      });
  }

  // The notification key for a deadline that has gone red or past due, or ""
  // when it hasn't. One notification per ticket, deadline and level.
  function alertKey(siteId, t, d, s) {
    if (!d || d.state !== "running") return "";
    const level = urgency(d.left, s.amber, s.red);
    if (level !== "red" && level !== "overdue") return "";
    return siteId + "|" + t.id + "|" + d.kind + "|" + level;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      readSettings, nextDeadline, urgency, formatSpan, badgeText, formatDue,
      describeDeadline, describeAll, sortByDeadline, alertKey,
    };
  }
  if (typeof window === "undefined" || !window.pluginAPI) return;

  // ===================== State =====================

  const api = window.pluginAPI;
  if (!api.ui || typeof api.ui.addSidePanelTab !== "function" || !api.sites || !api.browser) return;

  let settings = readSettings(api.getSettings());
  const tabRefs = new Map();   // tabId → { site, ref, key } for tabs showing a ticket
  const entries = new Map();   // key → { ticket, at, error, skipped, loading }
  let mine = { results: [], at: 0, loading: false }; // per site: { site, tickets, error, skipped, warnings }
  const alerted = new Set();
  let firstAlertPass = true;

  function slaSites() {
    return api.sites.list().filter(function (si) {
      return si.ticketSla && typeof si.ticketSla.refForUrl === "function" && typeof si.ticketSla.get === "function";
    });
  }

  function entryKey(site, ref) {
    return site.id + "|" + (ref.host || "") + "|" + ref.id;
  }

  // ===================== Fetching =====================

  function refFor(url) {
    if (!url) return null;
    const site = api.sites.forUrl(url);
    if (!site || !site.ticketSla || typeof site.ticketSla.refForUrl !== "function") return null;
    let ref = null;
    try { ref = site.ticketSla.refForUrl(url); } catch (e) { console.error("[sla-countdown] refForUrl:", e); }
    if (!ref || !ref.id) return null;
    return { site: site, ref: ref, key: entryKey(site, ref) };
  }

  async function fetchEntry(target, maxAge) {
    const old = entries.get(target.key);
    if (old && (old.loading || Date.now() - old.at < maxAge)) return;
    const entry = Object.assign({}, old || {}, { loading: true });
    entries.set(target.key, entry);
    let res;
    try {
      res = await target.site.ticketSla.get(target.ref);
    } catch (e) {
      res = { error: (e && e.message) || String(e) };
    }
    const next = { at: Date.now(), loading: false, ticket: null, error: "", skipped: false, site: target.site };
    if (res && res.ticket) next.ticket = Object.assign({ url: target.ref.url }, res.ticket);
    else {
      next.error = (res && res.error) || "No SLA times for this ticket.";
      next.skipped = !!(res && res.skipped);
      // Keep showing the last good times while a refresh fails.
      if (old && old.ticket && !next.skipped) next.ticket = old.ticket;
    }
    entries.set(target.key, next);
    renderAll();
  }

  function refreshTabs(maxAge) {
    const seen = new Set();
    tabRefs.forEach(function (target) {
      if (seen.has(target.key)) return;
      seen.add(target.key);
      fetchEntry(target, maxAge);
    });
    // Forget tickets no tab shows any more.
    entries.forEach(function (_v, key) { if (!seen.has(key)) entries.delete(key); });
  }

  async function refreshMine() {
    // A site that registers while a read is running gets read straight after.
    if (mine.loading) { mine.again = true; return; }
    const sites = slaSites().filter(function (si) { return typeof si.ticketSla.listMine === "function"; });
    mine.loading = true;
    renderPanel();
    const results = await Promise.all(sites.map(async function (site) {
      let res;
      try { res = await site.ticketSla.listMine(); } catch (e) { res = { error: (e && e.message) || String(e) }; }
      if (res && Array.isArray(res.tickets)) {
        return { site: site, tickets: res.tickets, warnings: res.warnings || [], total: res.total || res.tickets.length };
      }
      const prev = mine.results.find(function (r) { return r.site.id === site.id; });
      return {
        site: site,
        tickets: prev && !(res && res.skipped) ? prev.tickets : [],
        error: (res && res.error) || "The site didn't send your tickets.",
        skipped: !!(res && res.skipped),
        warnings: [],
      };
    }));
    const again = mine.again;
    mine = { results: results, at: Date.now(), loading: false };
    renderAll();
    if (again) refreshMine();
  }

  // ===================== Tabs =====================

  function trackTab(info) {
    if (!info || !info.tabId) return;
    const target = refFor(info.url);
    const prev = tabRefs.get(info.tabId);
    if (!target) {
      if (prev) { tabRefs.delete(info.tabId); renderBadge(info.tabId); }
      return;
    }
    tabRefs.set(info.tabId, target);
    if (!prev || prev.key !== target.key) {
      fetchEntry(target, settings.refresh * MINUTE);
      renderBadge(info.tabId);
    }
  }

  function tabElement(tabId) {
    const id = window.CSS && CSS.escape ? CSS.escape(tabId) : String(tabId).replace(/["\\]/g, "");
    return document.querySelector('.tab-item[data-tab-id="' + id + '"]');
  }

  function renderBadge(tabId) {
    const tabEl = tabElement(tabId);
    if (!tabEl) return;
    let badge = tabEl.querySelector(".sla-tab-badge");
    const target = tabRefs.get(tabId);
    const entry = target && entries.get(target.key);
    const now = Date.now();
    const d = entry && entry.ticket ? nextDeadline(entry.ticket, now) : null;
    const show = settings.badges && d && (d.state === "running" || d.state === "paused");
    if (!show) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "sla-tab-badge";
      const title = tabEl.querySelector(".tab-title");
      tabEl.insertBefore(badge, title || null);
    }
    if (d.state === "paused") {
      badge.textContent = "Hold";
      badge.className = "sla-tab-badge sla-paused";
    } else {
      badge.textContent = badgeText(d);
      badge.className = "sla-tab-badge sla-" + urgency(d.left, settings.amber, settings.red);
    }
    badge.title = (entry.ticket.label || "#" + entry.ticket.id) + ": " + describeDeadline(d, now) +
      "\n" + describeAll(entry.ticket, now);
  }

  function renderBadges() {
    let tabs = [];
    try { tabs = api.browser.getTabs(); } catch { /* no tabs yet */ }
    tabs.forEach(function (t) { renderBadge(t.tabId); });
  }

  api.events.on("tab:created", trackTab);
  api.events.on("tab:updated", trackTab);
  api.events.on("tab:activated", function (info) {
    trackTab(info);
    const target = tabRefs.get(info && info.tabId);
    if (target) fetchEntry(target, ACTIVATE_REFRESH_MS);
    renderPanel();
  });
  api.events.on("tab:closed", function (info) {
    if (info && tabRefs.delete(info.tabId)) refreshTabs(Infinity);
  });
  api.events.on("settings:changed", function (s) {
    settings = readSettings(s);
    renderAll();
  });

  function trackAllTabs() {
    let tabs = [];
    try { tabs = api.browser.getTabs(); } catch { /* no tabs yet */ }
    tabs.forEach(trackTab);
  }

  // ===================== Side panel =====================

  const tab = api.ui.addSidePanelTab({ id: TAB_ID, label: "SLA", icon: "⏱", title: "SLA countdown for your tickets", order: 17 });
  const panel = tab.element;
  panel.classList.add("sla-panel");
  panel.innerHTML =
    '<div class="sla-header">' +
    '  <span class="sla-heading">SLA countdown</span>' +
    '  <span id="sla-updated" class="sla-updated"></span>' +
    '  <button type="button" id="sla-refresh" class="sla-icon-btn" title="Read the due times again">↻</button>' +
    "</div>" +
    '<div class="sla-scroll">' +
    '  <div id="sla-current" class="sla-current" hidden></div>' +
    '  <div class="sla-section-title">Your open tickets</div>' +
    '  <div id="sla-list" class="sla-list"></div>' +
    '  <div id="sla-notes" class="sla-notes"></div>' +
    "</div>";

  const el = {
    updated: panel.querySelector("#sla-updated"),
    refresh: panel.querySelector("#sla-refresh"),
    current: panel.querySelector("#sla-current"),
    list: panel.querySelector("#sla-list"),
    notes: panel.querySelector("#sla-notes"),
  };

  el.refresh.addEventListener("click", function () {
    refreshMine();
    refreshTabs(0);
  });

  function openSettings(pluginId) {
    if (window.backupAPI && typeof window.backupAPI.openSettingsWindow === "function") {
      window.backupAPI.openSettingsWindow({ plugin: pluginId });
    }
  }

  // Switches to a tab already showing the ticket, else opens it in a new one.
  function openTicket(site, t) {
    let tabs = [];
    try { tabs = api.browser.getTabs(); } catch { /* none */ }
    const hit = tabs.find(function (info) {
      const target = tabRefs.get(info.tabId);
      return target && target.site.id === site.id && String(target.ref.id) === String(t.id);
    });
    if (hit) api.browser.activateTab(hit.tabId);
    else if (t.url) api.browser.newTab(t.url);
  }

  function message(text, buttonLabel, onClick) {
    const box = document.createElement("div");
    box.className = "sla-empty";
    const p = document.createElement("p");
    p.textContent = text;
    box.appendChild(p);
    if (buttonLabel) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small btn-secondary";
      b.textContent = buttonLabel;
      b.addEventListener("click", onClick);
      box.appendChild(b);
    }
    return box;
  }

  function pill(d) {
    const span = document.createElement("span");
    if (!d) {
      span.className = "sla-pill sla-none";
      span.textContent = "—";
    } else if (d.state === "paused") {
      span.className = "sla-pill sla-paused";
      span.textContent = "Hold";
    } else {
      span.className = "sla-pill sla-" + urgency(d.left, settings.amber, settings.red);
      span.textContent = badgeText(d);
    }
    return span;
  }

  function row(site, t, d, now) {
    const r = document.createElement("div");
    r.className = "sla-row";
    r.tabIndex = 0;
    r.title = describeAll(t, now) || "No SLA due time";
    r.appendChild(pill(d));
    const main = document.createElement("div");
    main.className = "sla-row-main";
    const title = document.createElement("div");
    title.className = "sla-row-title";
    const num = document.createElement("span");
    num.className = "sla-num";
    num.textContent = t.label || "#" + t.id;
    const subject = document.createElement("span");
    subject.className = "sla-subject";
    subject.textContent = t.subject || "";
    title.appendChild(num);
    title.appendChild(subject);
    const sub = document.createElement("div");
    sub.className = "sla-row-sub";
    sub.textContent = describeDeadline(d, now) + (t.priorityLabel ? " · " + t.priorityLabel : "");
    main.appendChild(title);
    main.appendChild(sub);
    r.appendChild(main);
    const open = function () { openTicket(site, t); };
    r.addEventListener("click", open);
    r.addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
    if (typeof api.ui.attachTicketPreview === "function" && t.url) {
      api.ui.attachTicketPreview(r, { ref: { siteId: site.id, id: String(t.id), kind: "ticket", url: t.url, initial: { subject: t.subject } } });
    }
    return r;
  }

  function renderCurrent(now) {
    el.current.innerHTML = "";
    let active = null;
    try { active = api.browser.getActiveTab(); } catch { /* none */ }
    const target = active && tabRefs.get(active.tabId);
    if (!target) { el.current.hidden = true; return; }
    el.current.hidden = false;
    const label = document.createElement("div");
    label.className = "sla-section-title";
    label.textContent = "This ticket";
    el.current.appendChild(label);
    const entry = entries.get(target.key);
    if (!entry || (!entry.ticket && entry.loading)) {
      el.current.appendChild(message("Reading the due times…"));
      return;
    }
    if (!entry.ticket) {
      el.current.appendChild(entry.skipped
        ? message(entry.error, "Open Settings", function () { openSettings(target.site.id); })
        : message(entry.error));
      return;
    }
    const t = entry.ticket;
    const d = nextDeadline(t, now);
    el.current.appendChild(row(target.site, t, d, now));
    const detail = document.createElement("div");
    detail.className = "sla-detail";
    detail.textContent = describeAll(t, now) || "This ticket has no SLA due times.";
    el.current.appendChild(detail);
  }

  function renderPanel() {
    const now = Date.now();
    renderCurrent(now);
    el.list.innerHTML = "";
    el.notes.innerHTML = "";
    el.updated.textContent = mine.loading ? "Updating…" : mine.at ? "Updated " + formatDue(mine.at, now) : "";

    const sites = slaSites();
    if (!sites.length) {
      el.list.appendChild(message(
        "None of your site plugins can read SLA due times yet. On Freshservice, install the Freshservice plugin 0.8.5 or later " +
        "(Settings → Plugins → Browse) and set up its API key."));
      return;
    }
    if (!mine.at) {
      el.list.appendChild(message(mine.loading ? "Reading your tickets…" : "Your tickets haven't been read yet."));
      return;
    }
    let shown = 0;
    mine.results.forEach(function (res) {
      if (res.error && !res.tickets.length) {
        el.list.appendChild(res.skipped
          ? message(res.site.name + ": " + res.error, "Open Settings", function () { openSettings(res.site.id); })
          : message(res.site.name + ": " + res.error));
        return;
      }
      if (res.error) el.notes.appendChild(message(res.site.name + ": " + res.error + " Showing the last list read."));
      sortByDeadline(res.tickets, now).forEach(function (x) {
        el.list.appendChild(row(res.site, x.ticket, x.d, now));
        shown++;
      });
      (res.warnings || []).forEach(function (w) {
        const p = document.createElement("p");
        p.className = "sla-note";
        p.textContent = w;
        el.notes.appendChild(p);
      });
    });
    if (!shown && !el.list.childElementCount) el.list.appendChild(message("No open tickets are assigned to you."));
  }

  // ===================== Alerts =====================

  function checkAlerts() {
    if (!settings.notify || typeof api.ui.notify !== "function") return;
    const now = Date.now();
    const fresh = [];
    const seen = new Set();
    const consider = function (site, t) {
      const d = nextDeadline(t, now);
      const key = alertKey(site.id, t, d, settings);
      if (!key || seen.has(key)) return;
      seen.add(key);
      if (alerted.has(key)) return;
      alerted.add(key);
      fresh.push({ site: site, t: t, d: d });
    };
    mine.results.forEach(function (res) { (res.tickets || []).forEach(function (t) { consider(res.site, t); }); });
    entries.forEach(function (entry) { if (entry.ticket && entry.site) consider(entry.site, entry.ticket); });
    const first = firstAlertPass;
    if (mine.at) firstAlertPass = false;
    if (!fresh.length) return;
    // At start-up, or when many go red at once, one summary instead of a pile.
    if (fresh.length > MAX_NOTIFY_SEPARATELY || (first && fresh.length > 1)) {
      const overdue = fresh.filter(function (x) { return x.d.left < 0; }).length;
      api.ui.notify({
        type: "sla-countdown-summary",
        title: fresh.length + " tickets are close to or past their SLA",
        desc: overdue ? overdue + " already past due." : "Each is within " + settings.red + " minutes of a deadline.",
        action: { label: "Show SLA tab", onClick: function () { tab.activate(); } },
      });
    } else {
      fresh.forEach(function (x) {
        const label = x.t.label || "#" + x.t.id;
        api.ui.notify({
          type: "sla-countdown-" + x.site.id + "-" + x.t.id,
          title: label + ": " + describeDeadline(x.d, now),
          desc: x.t.subject || "",
          action: { label: "Open ticket", onClick: function () { openTicket(x.site, x.t); } },
        });
      });
    }
  }

  function renderAll() {
    renderBadges();
    renderPanel();
    // Wait for the ticket list before the first alerts, so start-up gives one
    // summary rather than one alert per open tab.
    const listing = slaSites().some(function (si) { return typeof si.ticketSla.listMine === "function"; });
    if (mine.at || (!listing && entries.size)) checkAlerts();
  }

  // ===================== Timers =====================

  tab.onShow(function () {
    if (Date.now() - mine.at > ACTIVATE_REFRESH_MS) refreshMine();
    renderPanel();
  });

  let lastRefresh = Date.now();
  setInterval(function () {
    if (Date.now() - lastRefresh >= settings.refresh * MINUTE) {
      lastRefresh = Date.now();
      refreshTabs(settings.refresh * MINUTE - TICK_MS);
      // The list is read in the background only for alerts, or when it shows.
      if (settings.notify || tab.isActive()) refreshMine();
    }
    renderAll();
  }, TICK_MS);

  // Sites register after this script may have run (and onRegistered calls back
  // straight away for those already registered); pick up their tabs then.
  let sitesKnown = 0;
  api.sites.onRegistered(function () {
    trackAllTabs();
    sitesKnown++;
    if (settings.notify || tab.isActive()) refreshMine();
    renderPanel();
  });

  trackAllTabs();
  if (!sitesKnown && (settings.notify || tab.isActive())) refreshMine();
  renderPanel();
})();
