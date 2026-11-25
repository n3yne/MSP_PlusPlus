"use strict";

// Loads the Quick Actions renderer (plugins/quick-actions/renderer.js) against a
// stub DOM and a stub pluginAPI, to check that the Ctrl+K commands act on the
// ticket in the active tab, not the one the (hidden) Actions panel last showed.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "../plugins/quick-actions/renderer.js"), "utf-8");

function makeElement() {
  const byId = {};
  const listeners = {};
  return {
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    title: "",
    className: "",
    innerHTML: "",
    children: [],
    classList: { add() {}, remove() {} },
    appendChild(c) { this.children.push(c); return c; },
    querySelector(sel) { return (byId[sel] = byId[sel] || makeElement()); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit(name) { (listeners[name] || []).forEach((fn) => fn({})); },
  };
}

function ticketTab(id, ticketNumber) {
  return {
    id: id,
    webview: {
      ticketNumber: ticketNumber,
      executeJavaScript: async () => (ticketNumber ? { ticket: String(ticketNumber), id: ticketNumber, kind: "ticket" } : null),
      getURL: () => "https://example.freshservice.com/a/tickets/" + ticketNumber,
      addEventListener() {},
      reload() {},
    },
  };
}

function setup({ panelActive = false, confirm } = {}) {
  const tabs = [ticketTab(1, 100), ticketTab(2, 200), ticketTab(3, null)];
  let active = tabs[0];
  const commands = {};
  const providers = [];
  const updates = [];
  let shown = null;
  let panelIsActive = panelActive;
  const panelTab = {
    element: makeElement(),
    isActive: () => panelIsActive,
    activate: () => { panelIsActive = true; },
    onShow: (fn) => { shown = fn; },
  };
  const site = {
    id: "freshservice",
    name: "Freshservice",
    recordScript: "record",
    ticketActions: {
      options: async () => ({
        statuses: [{ value: 2, label: "Open" }, { value: 3, label: "Pending" }, { value: 4, label: "Resolved" }],
        priorities: [{ value: 1, label: "Low" }, { value: 3, label: "High" }],
        groups: [], agents: [], me: 42,
      }),
      get: async (found) => ({ ticket: { id: found.record.id, subject: "T" + found.record.id, status: 2, priority: 1, groupId: null, agentId: null } }),
      update: async (target, changes) => { updates.push({ ticket: target.record.id, changes: changes }); return { ok: true }; },
    },
  };
  const window = {
    pluginAPI: {
      getSettings: () => ({ quickActionsReloadTab: false, quickActionsConfirmResolve: !!confirm }),
      events: { on() {} },
      ui: { addSidePanelTab: () => panelTab, confirm: confirm || (async () => true) },
      browser: { getActiveTab: () => active, getTabs: () => tabs },
      sites: { forWebview: () => site, onRegistered() {} },
      commands: {
        register: (c) => { commands[c.id] = c; },
        // Same id check as the core's commands.addProvider (src/windows/renderer.js).
        addProvider: (p) => {
          if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(p.id)) throw new Error("commands.addProvider: invalid id");
          providers.push(p);
        },
      },
    },
  };
  const document = { createElement: () => makeElement() };
  vm.runInNewContext(SOURCE, { window, document, console, setTimeout, clearTimeout, Promise });
  return {
    commands, providers, updates, panelTab,
    show: async () => { shown(); await settle(); },
    activate: (i) => { active = tabs[i]; },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await flush(); };

describe("quick-actions command palette", () => {
  test("Assign to me acts on the active tab's ticket, not the one the hidden panel showed", async () => {
    const t = setup({ panelActive: true });
    await t.show(); // the panel loads #100
    t.panelTab.isActive = () => false; // the side panel switches to another tab
    t.activate(1); // the user moves to #200
    t.commands["quick-actions.assign-me"].run();
    await settle();
    expect(t.updates).toEqual([{ ticket: 200, changes: { agentId: "me" } }]);
  });

  test("on a page that isn't a ticket nothing is changed", async () => {
    const t = setup({ panelActive: true });
    await t.show();
    t.panelTab.isActive = () => false;
    t.activate(2);
    t.commands["quick-actions.resolve"].run();
    await settle();
    expect(t.updates).toEqual([]);
  });

  test("Set Ticket Status items don't name the stale ticket and apply to the active one", async () => {
    const t = setup({ panelActive: true });
    await t.show();
    t.panelTab.isActive = () => false;
    t.activate(1);
    const items = t.providers[0].items("pending");
    const pending = items.find((i) => i.id === "status-3");
    expect(pending.subtitle).not.toMatch(/100/);
    pending.run();
    await settle();
    expect(t.updates).toEqual([{ ticket: 200, changes: { status: 3 } }]);
  });

  test("Resolve is cancelled when the ticket changes while the confirmation is open", async () => {
    let answer;
    const t = setup({ panelActive: true, confirm: () => new Promise((r) => { answer = r; }) });
    await t.show();
    t.commands["quick-actions.resolve"].run();
    await settle();
    t.activate(1);
    await t.show(); // the visible panel follows the tab switch
    answer(true);
    await settle();
    expect(t.updates).toEqual([]);
  });
});
