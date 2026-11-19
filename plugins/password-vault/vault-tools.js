"use strict";

// Password Vault: the password generator and the clipboard clearing. No
// Electron here; main.js passes in the clipboard and timers.

const crypto = require("crypto");

const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";

// A short word list for passphrases: 256 common, easy-to-type words, so each
// word adds 8 bits. Five words (the default) is 40 bits plus the number.
const WORDS = (
  "able acid aged also area army away baby back ball band bank base bath bear beat bell belt best bird blow blue boat body bone book " +
  "boot born boss both bowl bulk burn bush busy cafe cake calm came camp card care cart case cash cast cell chat chip city clay clip " +
  "club coal coat code cold come cook cool cope copy core corn cost crew crop dark data date dawn deal dear deep desk dial diet disk " +
  "dock door down draw drop drum duck dust duty each earn east easy edge else even ever exit face fact fair fall farm fast fear feed " +
  "feel file fill film find fine fire firm fish five flag flat flow folk food foot form fort four free frog fuel full fund gain game " +
  "gate gear gift girl glad goal gold golf good grab gray grow half hall hand hang hard harm hat head heat help herb hero high hill " +
  "hint hold hole home hook hope horn host hour huge idea inch iron item jazz join jump keep kick kind king kite knee lake lamp land " +
  "lane last late lawn lead leaf left lens life lift like lime line link lion list live load loan lock long loop lord loud love luck " +
  "mail main make mall many mark mask meal meat menu mild milk mind mine mint miss mode moon more most move much nail name navy near " +
  "neck nest news next nice nine none nose note oak open oven over pack page pain pair palm park part pass past path peak pear pick " +
  "pine pink pipe plan play plot plus poem pole pond pool port post pull pure push quiz race rain rank rare read real rest rice rich " +
  "ride ring rise road rock roof room root rope rose ruby rule rush safe sail salt sand save seat seed"
).split(" ").slice(0, 256);

function pick(chars) {
  return chars[crypto.randomInt(chars.length)];
}

// opts: { mode: "chars"|"words", length (8-64), lower, upper, digits, symbols, words (3-10) }
function generate(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (o.mode === "words") {
    const n = Number.isInteger(o.words) ? Math.min(10, Math.max(3, o.words)) : 5;
    const parts = [];
    for (let i = 0; i < n; i++) parts.push(WORDS[crypto.randomInt(WORDS.length)]);
    // One word capitalised and a digit, which most password rules ask for.
    const cap = crypto.randomInt(n);
    parts[cap] = parts[cap][0].toUpperCase() + parts[cap].slice(1);
    return parts.join("-") + "-" + pick(DIGITS);
  }
  const length = Number.isInteger(o.length) ? Math.min(64, Math.max(8, o.length)) : 20;
  const sets = [];
  if (o.lower !== false) sets.push(LOWER);
  if (o.upper !== false) sets.push(UPPER);
  if (o.digits !== false) sets.push(DIGITS);
  if (o.symbols !== false) sets.push(SYMBOLS);
  if (sets.length === 0) sets.push(LOWER);
  const all = sets.join("");
  // One from each chosen set, the rest from all of them, then shuffled.
  const out = sets.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out.join("");
}

// Copies text and clears it after `seconds`, but only if the clipboard still
// holds what we put there, so something copied since isn't wiped.
// clipboard: { readText(), writeText(s) }; timers: { setTimeout, clearTimeout }
function createClipboardGuard(clipboard, timers) {
  const t = timers || { setTimeout, clearTimeout };
  let pending = null; // { text, timer }

  function clearNow() {
    if (!pending) return false;
    t.clearTimeout(pending.timer);
    const text = pending.text;
    pending = null;
    let cleared = false;
    try {
      if (clipboard.readText() === text) {
        clipboard.writeText("");
        cleared = true;
      }
    } catch { /* clipboard busy: leave it */ }
    return cleared;
  }

  function copy(text, seconds) {
    if (pending) {
      t.clearTimeout(pending.timer);
      pending = null;
    }
    clipboard.writeText(String(text));
    if (seconds > 0) {
      const p = { text: String(text), timer: null };
      p.timer = t.setTimeout(function () {
        if (pending === p) clearNow();
      }, seconds * 1000);
      if (p.timer && typeof p.timer.unref === "function") p.timer.unref();
      pending = p;
    }
  }

  return { copy, clearNow, hasPending: () => !!pending };
}

module.exports = { generate, createClipboardGuard, WORDS, LOWER, UPPER, DIGITS, SYMBOLS };
