"use strict";

// Login auto-fill helpers for the Password Vault (main process).
//
// Filling only happens when the user asks (a Fill button or Ctrl+Shift+F),
// only on an HTTPS page whose site matches the entry's website, and the
// password goes from main.js straight into the page: it never passes through
// the side panel. The script runs in an isolated world, so the page's own
// scripts can't change how it finds the fields, and it checks the page's
// origin again just before it fills, in case the tab moved on meanwhile.

const MATCH_MODES = ["host", "domain"]; // host: this site only; domain: this site and its subdomains

// Parses an entry's website or a page address into { protocol, host, port }.
// A website saved without "https://" is read as https.
function parseSite(u) {
  let s = typeof u === "string" ? u.trim() : "";
  if (!s || s.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  return { protocol: url.protocol, host, port: url.port };
}

function stripWww(host) {
  return host.startsWith("www.") ? host.slice(4) : host;
}

// Does an entry (its website and match mode) fit this page? The page must be
// HTTPS. "host" needs the same host (www. ignored) and port; "domain" also
// accepts any subdomain of the entry's host.
function siteMatches(entryUrl, pageUrl, match) {
  const page = parseSite(pageUrl);
  const entry = parseSite(entryUrl);
  if (!page || !entry || page.protocol !== "https:") return false;
  if (entry.port !== page.port) return false;
  const eh = stripWww(entry.host);
  const ph = stripWww(page.host);
  if (eh === ph) return true;
  // A bare word like "com" or "localhost" never matches other sites' subdomains.
  return match === "domain" && eh.includes(".") && ph.endsWith("." + eh);
}

function originOf(pageUrl) {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

// The script that fills the page. Runs in the page's main frame (isolated
// world). Returns { filled: "both" | "username" | "password" | "none", reason? }.
/* eslint-disable no-undef */
function pageFill(expectedOrigin, username, password) {
  if (location.origin !== expectedOrigin) return { filled: "none", reason: "moved" };
  const TEXTISH = ["text", "email", "tel", "url", ""];
  const USERISH = /user|email|e-mail|login|logon|account|identifier|upn|signin/i;
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  }
  function textish(el) {
    return TEXTISH.indexOf((el.getAttribute("type") || "").toLowerCase()) !== -1 && el.type !== "password";
  }
  function looksLikeUser(el) {
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
    if (ac.indexOf("username") !== -1 || ac.indexOf("email") !== -1) return 3;
    if (el.type === "email") return 2;
    const hint = [el.name, el.id, el.getAttribute("placeholder"), el.getAttribute("aria-label")].join(" ");
    return USERISH.test(hint) ? 1 : 0;
  }
  function setValue(el, value) {
    el.focus();
    // The native setter, so frameworks that track the value (React) see a change.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    desc.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const inputs = Array.prototype.filter.call(document.querySelectorAll("input"), visible);
  const passwords = inputs.filter(function (el) { return el.type === "password"; });
  let pwField = null;
  if (passwords.length) {
    pwField = passwords.find(function (el) {
      return (el.getAttribute("autocomplete") || "").toLowerCase().indexOf("current-password") !== -1;
    }) || passwords[0];
  }

  let userField = null;
  if (username) {
    let candidates = inputs.filter(textish);
    if (pwField) {
      // The text box just before the password box, in the same form if it has one.
      candidates = candidates.filter(function (el) {
        return (el.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      });
      const sameForm = candidates.filter(function (el) { return el.form === pwField.form; });
      if (sameForm.length) candidates = sameForm;
      const best = candidates.filter(function (el) { return looksLikeUser(el) >= 2; });
      userField = (best.length ? best : candidates).pop() || null;
    } else {
      // An "email first" page: only a box that looks like a username, or the only text box.
      let bestScore = 0;
      candidates.forEach(function (el) {
        const score = looksLikeUser(el);
        if (score > bestScore) { bestScore = score; userField = el; }
      });
      if (!userField && candidates.length === 1) userField = candidates[0];
    }
  }

  const didUser = !!(userField && username);
  const didPassword = !!(pwField && password);
  if (didUser) setValue(userField, username);
  if (didPassword) setValue(pwField, password);
  if (didPassword) pwField.focus();
  if (didUser && didPassword) return { filled: "both" };
  if (didUser) return { filled: "username" };
  if (didPassword) return { filled: "password" };
  return { filled: "none", reason: "no-fields" };
}
/* eslint-enable no-undef */

// The JavaScript string sent to the page. Values go in as JSON literals.
function buildFillScript(expectedOrigin, username, password) {
  return "(" + pageFill.toString() + ")(" +
    JSON.stringify(String(expectedOrigin)) + "," +
    JSON.stringify(String(username || "")) + "," +
    JSON.stringify(String(password || "")) + ")";
}

// Picks which matching entry the shortcut fills. Pressing it again on the same
// page within CYCLE_MS moves on to the next match. lastUsed maps id → time.
const CYCLE_MS = 10000;
function orderMatches(matches, lastUsed) {
  return matches.slice().sort(function (a, b) {
    const ua = lastUsed.get(a.id) || 0;
    const ub = lastUsed.get(b.id) || 0;
    if (ua !== ub) return ub - ua;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

module.exports = {
  MATCH_MODES,
  CYCLE_MS,
  parseSite,
  siteMatches,
  originOf,
  pageFill,
  buildFillScript,
  orderMatches,
};
