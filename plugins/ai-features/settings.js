(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("ai-features", "AI Features", function (panel) {

    const section = document.createElement("div");
    section.className = "settings-section";

    section.innerHTML =
      '<h3 class="settings-section-title">AI Features</h3>' +

      '<div class="settings-field">' +
      '  <label class="settings-field-label" for="ai-plugin-provider">Provider</label>' +
      '  <div class="settings-field-row">' +
      '    <select id="ai-plugin-provider" class="settings-select-input" title="AI provider">' +
      '      <option value="hatz">Hatz AI</option>' +
      '      <option value="openai">OpenAI</option>' +
      '      <option value="anthropic">Anthropic</option>' +
      '      <option value="azure">Azure OpenAI</option>' +
      '      <option value="m365copilot">Microsoft 365 Copilot (API)</option>' +
      '      <option value="copilotweb">Copilot website (no setup)</option>' +
      "    </select>" +
      "  </div>" +
      "</div>" +

      // Azure OpenAI: resource endpoint
      '<div class="settings-field settings-field-column" data-ai-providers="azure">' +
      '  <label class="settings-field-label" for="ai-plugin-azure-endpoint">Endpoint</label>' +
      '  <input type="url" id="ai-plugin-azure-endpoint" class="settings-text-input"' +
      '    placeholder="https://your-resource.openai.azure.com/" maxlength="300" spellcheck="false" autocomplete="off" />' +
      "</div>" +

      // Hatz / OpenAI / Anthropic: model picked from the provider's list
      '<div class="settings-field settings-field-column" data-ai-providers="hatz openai anthropic">' +
      '  <label class="settings-field-label" for="ai-plugin-model">Model</label>' +
      '  <select id="ai-plugin-model" class="settings-select-input">' +
      '    <option value="" disabled selected>Enter API key first</option>' +
      "  </select>" +
      "</div>" +

      // Azure OpenAI: deployment name is typed (deployments aren't listable with an API key)
      '<div class="settings-field settings-field-column" data-ai-providers="azure">' +
      '  <label class="settings-field-label" for="ai-plugin-deployment">Deployment Name</label>' +
      '  <input type="text" id="ai-plugin-deployment" class="settings-text-input"' +
      '    placeholder="e.g. gpt-4o" maxlength="100" spellcheck="false" autocomplete="off" />' +
      "</div>" +

      '<div class="settings-field settings-field-column" data-ai-providers="hatz openai anthropic azure">' +
      '  <label class="settings-field-label" for="ai-plugin-key">API Key</label>' +
      '  <input type="password" id="ai-plugin-key" class="settings-text-input"' +
      '    placeholder="Paste your API key here" maxlength="500" autocomplete="off" />' +
      "</div>" +

      // Microsoft 365 Copilot: Entra app registration + interactive sign-in
      '<div class="settings-field settings-field-column" data-ai-providers="m365copilot">' +
      '  <label class="settings-field-label" for="ai-plugin-m365-tenant">Directory (Tenant) ID</label>' +
      '  <input type="text" id="ai-plugin-m365-tenant" class="settings-text-input"' +
      '    placeholder="contoso.onmicrosoft.com or tenant GUID" maxlength="100" spellcheck="false" autocomplete="off" />' +
      "</div>" +
      '<div class="settings-field settings-field-column" data-ai-providers="m365copilot">' +
      '  <label class="settings-field-label" for="ai-plugin-m365-client">Application (Client) ID</label>' +
      '  <input type="text" id="ai-plugin-m365-client" class="settings-text-input"' +
      '    placeholder="00000000-0000-0000-0000-000000000000" maxlength="36" spellcheck="false" autocomplete="off" />' +
      "</div>" +
      '<div class="settings-field" data-ai-providers="m365copilot">' +
      '  <div class="settings-field-row">' +
      '    <button type="button" id="ai-plugin-m365-signin" class="btn btn-small btn-primary">Sign in</button>' +
      '    <span id="ai-plugin-m365-status" class="settings-description">Not signed in</span>' +
      "  </div>" +
      "</div>" +

      // Copilot website: a chat site signed in inside MSP++
      '<div class="settings-field settings-field-column" data-ai-providers="copilotweb">' +
      '  <label class="settings-field-label" for="ai-plugin-web-site">Chat site</label>' +
      '  <select id="ai-plugin-web-site" class="settings-select-input">' +
      '    <option value="copilot-work">Microsoft Copilot (work account)</option>' +
      '    <option value="copilot-consumer">Microsoft Copilot (copilot.microsoft.com)</option>' +
      '    <option value="custom">Other chat site</option>' +
      "  </select>" +
      "</div>" +
      '<div class="settings-field settings-field-column" data-ai-providers="copilotweb" id="ai-plugin-web-url-row">' +
      '  <label class="settings-field-label" for="ai-plugin-web-url">Chat site address</label>' +
      '  <input type="url" id="ai-plugin-web-url" class="settings-text-input"' +
      '    placeholder="https://chat.example.com/" maxlength="500" spellcheck="false" autocomplete="off" />' +
      "</div>" +
      '<div class="settings-field" data-ai-providers="copilotweb">' +
      '  <div class="settings-field-row">' +
      '    <button type="button" id="ai-plugin-web-open" class="btn btn-small btn-primary">Open and sign in</button>' +
      '    <button type="button" id="ai-plugin-web-test" class="btn btn-small btn-secondary">Test</button>' +
      '    <button type="button" id="ai-plugin-web-signout" class="btn btn-small btn-secondary">Sign out</button>' +
      "  </div>" +
      '  <span id="ai-plugin-web-status" class="settings-description"></span>' +
      "</div>" +
      // Windows device sign-on: only on an MSP++ that has it (0.8.6+ on Windows)
      '<div class="settings-field settings-field-column" data-ai-providers="copilotweb" id="ai-plugin-web-sso-row">' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="ai-plugin-web-sso" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Use Windows Device Sign-On</span>' +
      "  </label>" +
      '  <p class="settings-description">Signs in to Microsoft the way Edge does: Windows vouches that this PC is registered with ' +
      "your organisation, so sign-in rules that require a compliant device let you in. The proof only goes to Microsoft&#39;s sign-in page.</p>" +
      '  <p class="settings-description" id="ai-plugin-web-sso-state"></p>' +
      "</div>" +
      '<div class="settings-field settings-field-column" data-ai-providers="copilotweb">' +
      '  <label class="settings-toggle">' +
      '    <input type="checkbox" id="ai-plugin-web-auto" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">Send Automatically (experimental)</span>' +
      "  </label>" +
      '  <p class="settings-description">MSP++ presses Send itself in a hidden window and reads the reply, so you never see Copilot. ' +
      "Microsoft&#39;s terms don&#39;t allow automated use of its AI services, and a change to the site can stop this working until MSP++ is updated. " +
      "If it can&#39;t send or read the reply, the Copilot window opens so you can finish by hand.</p>" +
      "</div>" +

      '<p class="settings-description settings-description-field" id="ai-plugin-help"></p>';

    panel.appendChild(section);

    const HELP = {
      hatz: "Generate your API key from the Hatz Admin Dashboard.",
      openai: "Create an API key at platform.openai.com.",
      anthropic: "Create an API key at console.anthropic.com.",
      azure: "Use the endpoint and a key from your Azure OpenAI or Azure AI Foundry resource (Keys and Endpoint), " +
        "and the name of a chat model deployment.",
      m365copilot: "Requires a Microsoft 365 Copilot license and an Entra app registration with admin consent for the " +
        "Copilot Chat API permissions. Web search is turned off; Copilot may still draw on your Microsoft 365 data.",
      copilotweb: "Uses the Copilot website signed in inside MSP++: no app registration or API key, and free Copilot Chat " +
        "comes with a Microsoft work account. Each AI request opens a new chat in a Copilot window with the request typed in; " +
        "press Send, then click Use this reply. Requests go to Microsoft like anything you type into Copilot and show in your Copilot history.",
    };

    const elProvider   = panel.querySelector("#ai-plugin-provider");
    const elModel      = panel.querySelector("#ai-plugin-model");
    const elKey        = panel.querySelector("#ai-plugin-key");
    const elEndpoint   = panel.querySelector("#ai-plugin-azure-endpoint");
    const elDeployment = panel.querySelector("#ai-plugin-deployment");
    const elTenant     = panel.querySelector("#ai-plugin-m365-tenant");
    const elClient     = panel.querySelector("#ai-plugin-m365-client");
    const elSignIn     = panel.querySelector("#ai-plugin-m365-signin");
    const elM365Status = panel.querySelector("#ai-plugin-m365-status");
    const elHelp       = panel.querySelector("#ai-plugin-help");
    const elWebSite    = panel.querySelector("#ai-plugin-web-site");
    const elWebUrl     = panel.querySelector("#ai-plugin-web-url");
    const elWebUrlRow  = panel.querySelector("#ai-plugin-web-url-row");
    const elWebOpen    = panel.querySelector("#ai-plugin-web-open");
    const elWebTest    = panel.querySelector("#ai-plugin-web-test");
    const elWebSignOut = panel.querySelector("#ai-plugin-web-signout");
    const elWebStatus  = panel.querySelector("#ai-plugin-web-status");
    const elWebAuto    = panel.querySelector("#ai-plugin-web-auto");
    const elWebSso     = panel.querySelector("#ai-plugin-web-sso");
    const elWebSsoRow  = panel.querySelector("#ai-plugin-web-sso-row");
    const elWebSsoState = panel.querySelector("#ai-plugin-web-sso-state");
    let ssoSupported = false;

    // Shows only the fields that apply to the selected provider.
    function showProviderFields(provider) {
      panel.querySelectorAll("[data-ai-providers]").forEach(function (el) {
        const providers = el.getAttribute("data-ai-providers").split(" ");
        el.style.display = providers.includes(provider) ? "" : "none";
      });
      elHelp.textContent = HELP[provider] || "";
      if (provider === "copilotweb") showWebUrlRow();
      showSsoRow();
    }

    function showWebUrlRow() {
      elWebUrlRow.style.display = elProvider.value === "copilotweb" && elWebSite.value === "custom" ? "" : "none";
    }

    let m365SignedIn = false;

    async function refreshM365Status() {
      let result;
      try {
        result = await window.backupAPI.pluginInvoke("plugin:ai-features:m365-status", {});
      } catch {
        result = { account: null };
      }
      m365SignedIn = !!(result && result.account !== null && result.account !== undefined);
      elSignIn.textContent = m365SignedIn ? "Sign out" : "Sign in";
      elM365Status.textContent = m365SignedIn
        ? "Signed in" + (result.account ? " as " + result.account : "")
        : "Not signed in";
    }

    elSignIn.addEventListener("click", async function () {
      elSignIn.disabled = true;
      try {
        if (m365SignedIn) {
          await window.backupAPI.pluginInvoke("plugin:ai-features:m365-sign-out", {});
        } else {
          elM365Status.textContent = "Waiting for Microsoft sign-in…";
          // Send the form values directly — the settings save from the field's change
          // event may still be in flight.
          const result = await window.backupAPI.pluginInvoke("plugin:ai-features:m365-sign-in", {
            tenant: elTenant.value.trim(),
            clientId: elClient.value.trim(),
          });
          if (result && result.error) {
            elM365Status.textContent = result.error;
            return;
          }
        }
        await refreshM365Status();
      } finally {
        elSignIn.disabled = false;
      }
    });

    // Mirrors keyBelongsTo in main.js: a saved key only counts for the provider it
    // was entered for (older keys count for Hatz, OpenAI and Anthropic).
    let keyEnteredFor = null; // provider of a key typed in this window, before the saved flags catch up

    function hasKeyFor(s, provider) {
      if (keyEnteredFor) return keyEnteredFor === provider;
      if (!s.aiApiKeySet) return false;
      if (s.aiApiKeyProvider) {
        if (s.aiApiKeyProvider !== provider) return false;
        // An Azure key only counts for the endpoint it was entered for.
        if (provider === "azure" && s.aiApiKeyEndpoint && s.aiAzureEndpoint) {
          try { return new URL(s.aiAzureEndpoint).origin === s.aiApiKeyEndpoint; } catch { return false; }
        }
        return true;
      }
      return providerUsesModelList(provider);
    }

    async function populateModelDropdown() {
      const s = settingsAPI.getSettings();
      if (!hasKeyFor(s, s.aiProvider || "hatz")) {
        elModel.innerHTML = '<option value="" disabled selected>Enter API key first</option>';
        elModel.disabled = true;
        return;
      }
      elModel.innerHTML = '<option value="" disabled selected>Loading models…</option>';
      elModel.disabled = true;
      let result;
      try {
        result = await window.backupAPI.pluginInvoke("plugin:ai-features:get-models", {
          aiProvider: s.aiProvider || "hatz",
        });
      } catch {
        elModel.innerHTML = '<option value="" disabled selected>Error loading models</option>';
        elModel.disabled = false;
        return;
      }
      if (result.error || !result.models || !result.models.length) {
        const detail = result.error || "Empty model list returned";
        elModel.innerHTML = '<option value="" disabled selected></option>';
        elModel.options[0].textContent = "Error: " + detail.substring(0, 80);
        elModel.disabled = false;
        return;
      }
      elModel.innerHTML = "";
      result.models.forEach(function (m) {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        elModel.appendChild(opt);
      });
      const saved = settingsAPI.getSettings().aiModelName;
      const values = result.models.map(function (m) { return m.value; });
      if (saved && !values.includes(saved)) {
        const opt = document.createElement("option");
        opt.value = saved;
        opt.textContent = saved;
        elModel.insertBefore(opt, elModel.firstChild);
      }
      elModel.value = saved || values[0] || "";
      elModel.disabled = false;
      if (elModel.value !== saved) {
        settingsAPI.saveSettings({ aiModelName: elModel.value });
      }
    }

    function providerUsesModelList(provider) {
      return ["hatz", "openai", "anthropic"].includes(provider);
    }

    function applyForm(s) {
      const provider = s.aiProvider && s.aiProvider !== "none" ? s.aiProvider : "hatz";
      elProvider.value = provider;
      showProviderFields(provider);
      elKey.value = "";
      elKey.placeholder = hasKeyFor(s, provider) ? "••••••••  (saved)" : "Paste your API key here";
      // Don't overwrite a field the user is in the middle of editing.
      if (document.activeElement !== elEndpoint)   elEndpoint.value   = s.aiAzureEndpoint || "";
      if (document.activeElement !== elDeployment) elDeployment.value = s.aiAzureDeployment || "";
      if (document.activeElement !== elTenant)     elTenant.value     = s.aiM365TenantId || "";
      if (document.activeElement !== elClient)     elClient.value     = s.aiM365ClientId || "";
      if (document.activeElement !== elWebUrl)     elWebUrl.value     = s.aiWebUrl || "";
      elWebSite.value = s.aiWebSite || "copilot-work";
      elWebAuto.checked = s.aiWebAutoSend === true;
      elWebSso.checked = s.aiWebDeviceSso !== false;
      showWebUrlRow();
    }

    applyForm(settingsAPI.getSettings());
    const initial = settingsAPI.getSettings();
    if (providerUsesModelList(initial.aiProvider || "hatz") && hasKeyFor(initial, initial.aiProvider || "hatz")) populateModelDropdown();
    refreshM365Status();
    refreshSsoStatus();

    settingsAPI.onSettingsChanged(function (s) {
      applyForm(s);
      // Tenant/client ID changes decide whether the stored sign-in still applies.
      if (s.aiProvider === "m365copilot") refreshM365Status();
    });

    elProvider.addEventListener("change", async function () {
      const provider = elProvider.value;
      showProviderFields(provider);
      // Wait for the save so the model list is fetched with the saved provider.
      await settingsAPI.saveSettings({ aiProvider: provider });
      if (providerUsesModelList(provider)) populateModelDropdown();
      if (provider === "m365copilot") refreshM365Status();
    });

    // Saves a text field on change; invalid input is flagged and not saved.
    function bindTextSetting(el, key, isValid, invalidMessage) {
      el.addEventListener("change", function () {
        const val = el.value.trim();
        if (val && !isValid(val)) {
          el.setCustomValidity(invalidMessage);
          el.reportValidity();
          return;
        }
        el.setCustomValidity("");
        el.value = val;
        const update = {};
        update[key] = val;
        settingsAPI.saveSettings(update);
      });
      el.addEventListener("input", function () { el.setCustomValidity(""); });
    }

    bindTextSetting(elEndpoint, "aiAzureEndpoint", function (v) {
      try { return new URL(v).protocol === "https:"; } catch { return false; }
    }, "Enter an https:// URL, e.g. https://your-resource.openai.azure.com/");
    bindTextSetting(elDeployment, "aiAzureDeployment", function (v) { return v.length <= 100; }, "Too long");
    bindTextSetting(elTenant, "aiM365TenantId", function (v) {
      return /^[a-zA-Z0-9.-]{1,100}$/.test(v);
    }, "Enter a tenant GUID or domain, e.g. contoso.onmicrosoft.com");
    bindTextSetting(elClient, "aiM365ClientId", function (v) {
      return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);
    }, "Enter the Application (client) ID GUID from your app registration");

    bindTextSetting(elWebUrl, "aiWebUrl", function (v) {
      try { return new URL(v).protocol === "https:"; } catch { return false; }
    }, "Enter an https:// address, e.g. https://chat.example.com/");

    elWebSite.addEventListener("change", function () {
      showWebUrlRow();
      settingsAPI.saveSettings({ aiWebSite: elWebSite.value });
    });

    // Hides the device sign-on toggle on an MSP++ without it and says whether
    // this PC has a proof to send.
    async function refreshSsoStatus() {
      let st;
      try {
        st = await window.backupAPI.pluginInvoke("plugin:ai-features:copilotweb-sso-status", {});
      } catch {
        st = null;
      }
      ssoSupported = !!(st && st.supported);
      showSsoRow();
      if (!ssoSupported) return;
      elWebSsoState.textContent = st.available
        ? "This PC is registered with your organisation: device sign-on is available."
        : "No device sign-on on this PC. It needs a PC registered with your organisation (Entra ID) and Windows signed in with your work account.";
    }

    function showSsoRow() {
      elWebSsoRow.style.display = elProvider.value === "copilotweb" && ssoSupported ? "" : "none";
    }

    elWebSso.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiWebDeviceSso: elWebSso.checked });
    });

    elWebAuto.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiWebAutoSend: elWebAuto.checked });
    });

    elWebOpen.addEventListener("click", async function () {
      let result;
      try {
        result = await window.backupAPI.pluginInvoke("plugin:ai-features:copilotweb-open", {});
      } catch {
        result = { error: "Couldn't open the chat site." };
      }
      elWebStatus.textContent = result && result.error
        ? result.error
        : "Sign in in the Copilot window if asked. MSP++ remembers the sign-in.";
    });

    elWebSignOut.addEventListener("click", async function () {
      elWebSignOut.disabled = true;
      try {
        await window.backupAPI.pluginInvoke("plugin:ai-features:copilotweb-sign-out", {});
        elWebStatus.textContent = "Signed out of the chat site.";
      } catch {
        elWebStatus.textContent = "Couldn't sign out.";
      } finally {
        elWebSignOut.disabled = false;
      }
    });

    elWebTest.addEventListener("click", async function () {
      elWebTest.disabled = true;
      elWebStatus.textContent = elWebAuto.checked
        ? "Sending a test request…"
        : "A test request is in the Copilot window: press Send, then click Use this reply.";
      try {
        const result = await window.backupAPI.pluginInvoke("plugin:ai-features:complete", {
          prompt: "This is a connection test from MSP++. Reply with only the word: OK",
        });
        elWebStatus.textContent = result && result.error
          ? result.error
          : "Working. Reply: " + String(result && result.result || "").trim().substring(0, 80);
      } catch {
        elWebStatus.textContent = "The test request failed.";
      } finally {
        elWebTest.disabled = false;
      }
    });

    elModel.addEventListener("change", function () {
      settingsAPI.saveSettings({ aiModelName: elModel.value });
    });

    elKey.addEventListener("change", async function () {
      const val = elKey.value.trim();
      if (val) {
        const provider = elProvider.value;
        elKey.value = "";
        // The main process reads the key from saved settings, so the model list
        // can only be fetched once this save has finished.
        const result = await settingsAPI.saveSettings({ aiApiKey: val });
        if (!result || !result.success) {
          elKey.setCustomValidity((result && result.error) || "The API key could not be saved.");
          elKey.reportValidity();
          return;
        }
        keyEnteredFor = provider;
        elKey.placeholder = "••••••••  (saved)";
        if (providerUsesModelList(provider)) populateModelDropdown();
      }
    });
    elKey.addEventListener("input", function () { elKey.setCustomValidity(""); });
  });

}());
