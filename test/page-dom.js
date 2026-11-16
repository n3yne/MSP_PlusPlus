"use strict";

// A small stand-in for a web page, for running the site plugins' page scripts
// (the strings a site adapter hands to webview.executeJavaScript) in Jest's node
// environment. It models only what those scripts use: a tree of elements, a
// handful of CSS selectors, focus, events that capture and bubble, visibility
// through style.display, and stubs for selection, execCommand and
// MutationObserver. It is not a browser: layout, real editing and HTML parsing
// are left out, so a test here shows a script's logic, not how a live
// Freshservice or ConnectWise page reacts to it.

// ---------- Selectors ----------
// Supports: tag, .class, #id, [attr], [attr=v], [attr*=v] (quotes optional),
// :not(simple), compounds of those, descendant combinators and comma lists.

function splitTop(selector, separator) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const ch of selector) {
    if (quote) { if (ch === quote) quote = ""; current += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (depth === 0 && separator.test(ch)) { if (current) parts.push(current); current = ""; continue; }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesSimple(el, part) {
  if (part.startsWith(".")) return el.classList.contains(part.slice(1));
  if (part.startsWith("#")) return el.getAttribute("id") === part.slice(1);
  if (part.startsWith(":not(")) return !matchesCompound(el, part.slice(5, -1));
  if (part.startsWith("[")) {
    const m = /^\[([\w-]+)(?:(\*?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]$/.exec(part);
    if (!m) throw new Error("page-dom: unsupported selector part " + part);
    const actual = el.getAttribute(m[1]);
    if (actual === null) return false;
    if (!m[2]) return true;
    const wanted = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5];
    return m[2] === "=" ? actual === wanted : actual.includes(wanted);
  }
  return part === "*" || el.tagName === part.toUpperCase();
}

function matchesCompound(el, compound) {
  const parts = compound.match(/^[a-zA-Z0-9*]+|\.[\w-]+|#[\w-]+|\[[^\]]*\]|:not\([^)]*\)/g);
  if (!parts || parts.join("") !== compound) throw new Error("page-dom: unsupported selector " + compound);
  return parts.every((p) => matchesSimple(el, p));
}

function matchesSelector(el, selector) {
  return splitTop(selector, /,/).some((alt) => {
    const chain = splitTop(alt.trim(), /\s/);
    if (!matchesCompound(el, chain[chain.length - 1])) return false;
    let node = el.parentElement;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (node && !matchesCompound(node, chain[i])) node = node.parentElement;
      if (!node) return false;
      node = node.parentElement;
    }
    return true;
  });
}

// ---------- Events ----------

class Event {
  constructor(type, init) {
    this.type = type;
    this.bubbles = !!(init && init.bubbles);
    this.cancelable = !!(init && init.cancelable);
    Object.assign(this, init || {});
    this.target = null;
  }
}
class KeyboardEvent extends Event {}
class MouseEvent extends Event {}
class ClipboardEvent extends Event {}
class DataTransfer {
  constructor() { this.data = {}; }
  setData(type, value) { this.data[type] = value; }
  getData(type) { return this.data[type] || ""; }
}

class EventTarget {
  constructor() { this._listeners = []; this.events = []; }
  addEventListener(type, fn, capture) { this._listeners.push({ type, fn, capture: !!capture }); }
  _fire(event, capture) {
    this._listeners.filter((l) => l.type === event.type && l.capture === capture).forEach((l) => l.fn(event));
  }
}

// ---------- Nodes ----------

class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.parentElement = null; }
}

class Element extends EventTarget {
  constructor(tag, spec) {
    super();
    const s = spec || {};
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.parentElement = null;
    this.childNodes = [];
    this.style = Object.assign({}, s.style);
    this._attrs = {};
    this._text = s.text;
    this.disabled = !!s.disabled;
    this.readOnly = !!s.readOnly;
    this.insertedHtml = [];
    const classes = new Set(String(s.class || "").split(/\s+/).filter(Boolean));
    this.classList = {
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); },
      contains: (c) => classes.has(c),
      toString: () => Array.from(classes).join(" "),
    };
    Object.entries(s.attrs || {}).forEach(([k, v]) => this.setAttribute(k, v));
    (s.children || []).forEach((c) => this.appendChild(c));
  }

  // Attributes. id, name, placeholder and type read through to them, as in a page.
  getAttribute(name) {
    if (name === "class") return this.classList.toString() || null;
    return Object.prototype.hasOwnProperty.call(this._attrs, name) ? this._attrs[name] : null;
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  removeAttribute(name) { delete this._attrs[name]; }
  get id() { return this._attrs.id || ""; }
  get name() { return this._attrs.name || ""; }
  get placeholder() { return this._attrs.placeholder || ""; }
  get type() { return this._attrs.type || (this.tagName === "INPUT" ? "text" : ""); }

  // Tree
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  appendChild(child) {
    const node = typeof child === "string" ? new TextNode(child) : child;
    if (node.parentElement) node.remove();
    node.parentElement = this;
    this.childNodes.push(node);
    notifyMutation(this, [node]);
    return node;
  }
  remove() {
    const parent = this.parentElement;
    if (!parent) return;
    parent.childNodes = parent.childNodes.filter((n) => n !== this);
    this.parentElement = null;
    notifyMutation(parent, []);
  }
  contains(node) {
    for (let n = node; n; n = n.parentElement) if (n === this) return true;
    return false;
  }
  get isConnected() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n.isDocumentRoot === true;
  }
  _descendants(out) {
    this.children.forEach((c) => { out.push(c); c._descendants(out); });
    return out;
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector) { return this._descendants([]).filter((e) => e.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  // Visibility: hidden when this element or an ancestor has display:none, or it
  // isn't in the page. A hidden element has no boxes and, like in Chromium, an
  // empty innerText.
  get _hidden() {
    if (!this.isConnected) return true;
    for (let n = this; n; n = n.parentElement) if (n.style.display === "none") return true;
    return false;
  }
  getClientRects() { return this._hidden ? [] : [{ width: 10, height: 10 }]; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 30, height: 40 }; }
  get offsetParent() { return this._hidden ? null : (this.parentElement || null); }
  get isContentEditable() { return this.closest('[contenteditable="true"]') !== null; }

  // Text
  get textContent() {
    return this._text !== undefined ? this._text : this.childNodes.map((n) => n.textContent).join("");
  }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get innerText() { return this._hidden ? "" : this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this._html || ""; }
  set innerHTML(v) { this._html = String(v); }
  insertAdjacentHTML(where, html) { this.insertedHtml.push([where, html]); }

  // Focus and events
  focus() {
    const doc = this._document();
    if (!doc || doc.activeElement === this) return;
    if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
    doc.activeElement = this;
    this.dispatchEvent(new Event("focus"));
    this.dispatchEvent(new Event("focusin", { bubbles: true }));
  }
  blur() {
    const doc = this._document();
    if (!doc || doc.activeElement !== this) return;
    doc.activeElement = doc.body;
    this.dispatchEvent(new Event("blur"));
    this.dispatchEvent(new Event("focusout", { bubbles: true }));
  }
  _document() {
    let n = this;
    while (n.parentElement) n = n.parentElement;
    return n.ownerDocument || null;
  }
  dispatchEvent(event) {
    event.target = this;
    this.events.push(event);
    const path = [];
    for (let n = this; n; n = n.parentElement) path.push(n);
    const doc = this._document();
    if (doc) path.push(doc);
    path.slice().reverse().forEach((n) => n._fire(event, true));
    (event.bubbles ? path : [this]).forEach((n) => n._fire(event, false));
    return true;
  }
  // The types of the events dispatched on this element, in order.
  eventTypes() { return this.events.map((e) => e.type); }
}

function valueAccessor(proto) {
  Object.defineProperty(proto, "value", {
    configurable: true,
    get() { return this._value === undefined ? "" : this._value; },
    set(v) { this._value = String(v); },
  });
}

class HTMLTextAreaElement extends Element {
  constructor(spec) {
    super("textarea", spec);
    const s = spec || {};
    this._value = s.value || "";
    this.selectionStart = s.selectionStart !== undefined ? s.selectionStart : this._value.length;
    this.selectionEnd = s.selectionEnd !== undefined ? s.selectionEnd : this.selectionStart;
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
valueAccessor(HTMLTextAreaElement.prototype);

class HTMLInputElement extends Element {
  constructor(spec) { super("input", spec); this._value = (spec && spec.value) || ""; }
}
valueAccessor(HTMLInputElement.prototype);

// el("div.box", { attrs, style, text, children }) — the class list can ride on the tag.
function el(tagAndClasses, spec) {
  const [tag, ...classes] = tagAndClasses.split(".");
  const s = Object.assign({}, spec);
  s.class = classes.concat(s.class || []).join(" ");
  if (tag === "textarea") return new HTMLTextAreaElement(s);
  if (tag === "input") return new HTMLInputElement(s);
  return new Element(tag, s);
}

// ---------- MutationObserver ----------
// Callbacks run synchronously when a node is added to or removed from an
// observed subtree, and when a test calls page.mutate().

let observers = [];

function notifyMutation(target, addedNodes) {
  observers.slice().forEach((o) => {
    if (o.target && o.target.contains(target)) o.callback([{ type: "childList", target, addedNodes }], o.api);
  });
}

function makeMutationObserver() {
  return class MutationObserver {
    constructor(callback) { this.entry = { callback, target: null, api: this }; }
    observe(target) { this.entry.target = target; if (!observers.includes(this.entry)) observers.push(this.entry); }
    disconnect() { observers = observers.filter((o) => o !== this.entry); }
  };
}

// ---------- Page ----------

// makePage({ body: [elements], title, url, globals }) → a page with:
//   run(script)        evaluates a page script and returns its value
//   document, window   the stubs the script sees
//   logs               console.log lines the script wrote
//   mutate()           tells MutationObservers something changed (e.g. a style)
function makePage(options) {
  const opts = options || {};
  observers = [];
  const location = new URL(opts.url || "https://example.test/");
  const body = el("body");
  const head = el("head");
  const root = el("html", { children: [head, body] });
  root.isDocumentRoot = true;

  const selection = {
    ranges: [],
    get rangeCount() { return this.ranges.length; },
    getRangeAt(i) { return this.ranges[i]; },
    removeAllRanges() { this.ranges = []; },
    addRange(r) { this.ranges.push(r); },
  };

  const document = new EventTarget();
  Object.assign(document, {
    title: opts.title || "",
    documentElement: root,
    head,
    body,
    activeElement: body,
    commands: [],
    // Tests replace this to model an editor that takes (or refuses) a command.
    execCommand(name, ui, value) { document.commands.push([name, value]); return false; },
    createElement: (tag) => el(tag),
    createRange: () => ({
      commonAncestorContainer: null,
      collapsed: false,
      selectNodeContents(node) { this.commonAncestorContainer = node; this.contents = node; },
      collapse(toStart) { this.collapsed = true; this.atEnd = !toStart; },
    }),
    getElementById: (id) => root.querySelectorAll("[id]").find((e) => e.id === id) || null,
    querySelectorAll: (selector) => root.querySelectorAll(selector),
    querySelector: (selector) => root.querySelector(selector),
  });
  root.ownerDocument = document;

  const logs = [];
  const console = { log: (line) => logs.push(String(line)), warn: () => {} };
  const window = Object.assign({
    location,
    document,
    HTMLTextAreaElement,
    HTMLInputElement,
    getSelection: () => selection,
  }, opts.globals);

  (opts.body || []).forEach((child) => body.appendChild(child));

  // Globals a page script can name. Leave DataTransfer and ClipboardEvent out
  // (clipboard: false) to model a page where building a paste event throws.
  const scope = {
    window, document, location, console,
    MutationObserver: makeMutationObserver(),
    Event, KeyboardEvent, MouseEvent,
    DataTransfer: opts.clipboard === false ? undefined : DataTransfer,
    ClipboardEvent: opts.clipboard === false ? undefined : ClipboardEvent,
    setTimeout, clearTimeout,
  };

  return {
    document, window, body, head, selection, logs,
    run(script) {
      const names = Object.keys(scope);
      return new Function(...names, "return " + script)(...names.map((n) => scope[n]));
    },
    mutate(target) { notifyMutation(target || body, []); },
    // Parsed payloads of the console lines that start with `prefix`.
    messages(prefix) {
      return logs.filter((l) => l.startsWith(prefix)).map((l) => JSON.parse(l.slice(prefix.length)));
    },
  };
}

module.exports = { makePage, el, Event };
