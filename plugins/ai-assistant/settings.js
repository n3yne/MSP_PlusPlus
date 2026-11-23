// AI Assistant plugin — Settings window panel
// The assistant uses AI Features for the AI and the Freshservice plugin's API for
// lookups. This panel shows whether both are ready, which way the AI will be
// used, lets you test a lookup, and holds the prompt settings.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  const PROVIDER_NAMES = {
    hatz: "Hatz AI",
    openai: "OpenAI",
    anthropic: "Anthropic",
    azure: "Azure OpenAI",
    m365copilot: "Microsoft 365 Copilot",
    copilotweb: "the Copilot website",
  };
  // Providers AI Features can do tool calling with (keep in step with ai-features/tool-chat.js).
  const TOOL_PROVIDERS = ["azure", "openai", "anthropic"];
  // Keep in step with main.js.
  const MAX_INSTRUCTIONS = 2000;

  settingsAPI.addPanel("ai-assistant", "AI Assistant", function (panel) {
    const section = document.createElement("div");
    section.className = "settings-section";
    section.innerHTML =
      '<h3 class="settings-section-title">AI Assistant</h3>' +
      '<p class="settings-description settings-description-field">' +
      "Open the <strong>🤖 Assistant</strong> tab in the side panel to use it. It answers questions by reading Freshservice " +
      "through its API (read-only) with the AI provider from <strong>AI Features</strong>. " +
      "Both need to be set up:" +
      "</p>" +
      '<ul class="aa-settings-checklist">' +
      '  <li id="aa-settings-ai"></li>' +
      '  <li id="aa-settings-mode"></li>' +
      '  <li id="aa-settings-fs"></li>' +
      "</ul>" +
      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="aa-settings-ticket">Test a ticket lookup</label>' +
      '  <div class="settings-field-row">' +
      '    <input type="text" id="aa-settings-ticket" class="settings-text-input" placeholder="Ticket number, e.g. 4521"' +
      '      maxlength="13" spellcheck="false" autocomplete="off" />' +
      '    <button type="button" id="aa-settings-test" class="btn btn-small btn-primary">Look up</button>' +
      "  </div>" +
      '  <p id="aa-settings-result" class="settings-description"></p>' +
      "</div>" +
      '<h3 class="settings-section-title">Prompt</h3>' +
      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="aa-settings-only" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Only use data from MSP++</span>' +
      "  </label>" +
      '  <p class="settings-description">Tells the AI to answer only from what MSP++ looks up and sends it, and from your question. ' +
      "It's asked not to use anything else it knows or remembers about you, your organisation or your tickets " +
      "(such as Copilot&#39;s memory, earlier chats, or your files, emails and calendar), and not to search the web. " +
      "This is an instruction in the prompt: the AI usually follows it, but MSP++ can&#39;t switch those features off.</p>" +
      "</div>" +
      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="aa-settings-instructions">Extra instructions</label>' +
      '  <textarea id="aa-settings-instructions" class="aa-settings-instructions" rows="4" maxlength="' + MAX_INSTRUCTIONS + '"' +
      '    spellcheck="true" placeholder="For example: Answer in British English. Keep answers under 150 words."></textarea>' +
      '  <p class="settings-description"><span id="aa-settings-instructions-state">Added to every question you ask.</span> ' +
      "Up to " + MAX_INSTRUCTIONS + " characters. The assistant stays read-only whatever they say.</p>" +
      "</div>" +
      '<p class="settings-description settings-description-field">' +
      "What the assistant looks up is sent to your AI provider with the question, and each answer lists it. " +
      "Its lookups only read data: it can't change tickets or anything else." +
      "</p>";
    panel.appendChild(section);

    const elAi = panel.querySelector("#aa-settings-ai");
    const elMode = panel.querySelector("#aa-settings-mode");
    const elFs = panel.querySelector("#aa-settings-fs");
    const elTicket = panel.querySelector("#aa-settings-ticket");
    const elTest = panel.querySelector("#aa-settings-test");
    const elResult = panel.querySelector("#aa-settings-result");
    const elOnly = panel.querySelector("#aa-settings-only");
    const elInstructions = panel.querySelector("#aa-settings-instructions");
    const elInstructionsState = panel.querySelector("#aa-settings-instructions-state");

    function showPromptSettings(s) {
      elOnly.checked = s.aiAssistantOnlyProvidedData === true;
      // Don't overwrite what's being typed.
      if (document.activeElement !== elInstructions) {
        elInstructions.value = typeof s.aiAssistantInstructions === "string" ? s.aiAssistantInstructions : "";
      }
    }
    showPromptSettings(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(showPromptSettings);

    elOnly.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiAssistantOnlyProvidedData: elOnly.checked });
    });

    let saveTimer = null;
    async function saveInstructions() {
      clearTimeout(saveTimer);
      saveTimer = null;
      const value = elInstructions.value.substring(0, MAX_INSTRUCTIONS);
      const saved = settingsAPI.getSettings().aiAssistantInstructions || "";
      if (value === saved) return;
      try {
        const res = await settingsAPI.saveSettings({ aiAssistantInstructions: value });
        elInstructionsState.textContent = res && res.success === false ? "Couldn't save them." : "Saved. Added to every question you ask.";
      } catch {
        elInstructionsState.textContent = "Couldn't save them.";
      }
    }
    elInstructions.addEventListener("input", function () {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveInstructions, 600);
    });
    elInstructions.addEventListener("blur", saveInstructions);

    function setLine(el, ok, text) {
      el.textContent = (ok === null ? "• " : ok ? "✓ " : "✗ ") + text;
      el.className = ok === null ? "" : ok ? "aa-ok" : "aa-missing";
    }

    async function m365SignedIn() {
      try {
        const res = await window.backupAPI.pluginInvoke("plugin:ai-features:m365-status", {});
        return !!(res && res.account);
      } catch { return false; }
    }

    let renderSeq = 0;
    async function render(s) {
      const seq = ++renderSeq;
      const provider = s.aiProvider;
      const name = PROVIDER_NAMES[provider];
      if (!name) {
        setLine(elAi, false, "AI Features: choose a provider in Plugins → AI Features.");
      } else if (provider === "m365copilot") {
        const ok = await m365SignedIn();
        if (seq !== renderSeq) return;
        setLine(elAi, ok, ok
          ? "AI Features: using Microsoft 365 Copilot."
          : "AI Features: Microsoft 365 Copilot is selected but not signed in.");
      } else if (provider === "copilotweb") {
        setLine(elAi, true, "AI Features: using the Copilot website.");
      } else {
        const keyed = s.aiApiKeySet && (!s.aiApiKeyProvider || s.aiApiKeyProvider === provider);
        setLine(elAi, !!keyed, keyed
          ? "AI Features: using " + name + "."
          : "AI Features: " + name + " is selected but has no API key.");
      }

      if (!name) {
        elMode.textContent = "";
        elMode.className = "";
      } else if (TOOL_PROVIDERS.includes(provider)) {
        setLine(elMode, null, "With " + name + " the AI decides what to look up (up to 8 lookups per question).");
      } else {
        setLine(elMode, null, "With " + name + " the assistant first looks up the open ticket and any ticket numbers " +
          "and email addresses in your question. The AI can then ask for more lookups, which are sent back to it" +
          (provider === "copilotweb" ? " (up to 2 more rounds, each one another Send in the Copilot window)." : " (up to 3 more rounds).") +
          " Azure OpenAI, OpenAI or Anthropic look things up in one go.");
      }

      if (s.fsApiEnabled === false) {
        setLine(elFs, false, "Freshservice API: turned off. Turn it on in Plugins → Freshservice.");
      } else if (!s.fsApiDomain) {
        setLine(elFs, false, "Freshservice API: enter your domain in Plugins → Freshservice.");
      } else if (!s.fsApiKeySet) {
        setLine(elFs, false, "Freshservice API: enter your API key in Plugins → Freshservice.");
      } else if (s.fsApiKeyHost && s.fsApiKeyHost !== s.fsApiDomain) {
        setLine(elFs, false, "Freshservice API: the saved API key was entered for " + s.fsApiKeyHost + ". Enter it again in Plugins → Freshservice.");
      } else {
        setLine(elFs, true, "Freshservice API: connected to " + s.fsApiDomain + ".");
      }
    }

    render(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(render);

    async function testLookup() {
      const id = elTicket.value.trim().replace(/^#/, "");
      if (!/^\d{1,12}$/.test(id)) { elResult.textContent = "Enter a ticket number."; elTicket.focus(); return; }
      elTest.disabled = true;
      elResult.textContent = "Looking up…";
      try {
        const res = await window.backupAPI.pluginInvoke("plugin:freshservice:assistant-lookup",
          { tool: "get_ticket", args: { ticket_id: Number(id) } });
        if (!res || res.error) {
          elResult.textContent = (res && res.error) || "The lookup failed.";
        } else {
          const subject = String(res.content || "").split("\n").find(function (l) { return /^Ticket #/.test(l); }) || res.label;
          elResult.textContent = "It worked: " + subject;
        }
      } catch {
        elResult.textContent = "The Freshservice plugin isn't available, or is too old for the assistant. Update it under Plugins and restart.";
      } finally {
        elTest.disabled = false;
      }
    }

    elTest.addEventListener("click", testLookup);
    elTicket.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); testLookup(); }
    });
  });
}());
