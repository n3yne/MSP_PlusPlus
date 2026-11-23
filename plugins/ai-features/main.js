"use strict";

const { createM365Client, TENANT_PATTERN, CLIENT_ID_PATTERN } = require("./m365");
const { fetchWithTimeout } = require("./http");
const { createCopilotWeb, siteFor, normalizeSiteUrl, SITES } = require("./copilot-web");
const toolChat = require("./tool-chat");

const PROVIDERS = ["hatz", "openai", "anthropic", "azure", "m365copilot", "copilotweb"];

const MAX_NOTES_CHARS        = 8000;
const MAX_CONTEXT_CHARS      = 4000;
const MAX_INSTRUCTIONS_CHARS = 500;
const MAX_COMPLETE_CHARS     = 60000;
const REQUEST_TIMEOUT_MS     = 60000;

module.exports = {

  defaultSettings: {
    aiEnabled: true,
    aiProvider: "hatz",
    aiModelName: "",
    aiAzureEndpoint: "",
    aiAzureDeployment: "",
    aiM365TenantId: "",
    aiM365ClientId: "",
    aiWebSite: "copilot-work",
    aiWebUrl: "",
    aiWebAutoSend: false,
    aiWebDeviceSso: true,
  },

  validateSettings: function (s) {
    if (s.aiEnabled !== undefined && typeof s.aiEnabled !== "boolean") return false;
    if (s.aiProvider !== undefined && !["none", ...PROVIDERS].includes(s.aiProvider)) return false;
    if (s.aiModelName !== undefined && (typeof s.aiModelName !== "string" || s.aiModelName.length > 100)) return false;
    if (s.aiApiKey !== undefined && (typeof s.aiApiKey !== "string" || s.aiApiKey.length > 500)) return false;
    if (s.aiApiKeyEncrypted !== undefined && (typeof s.aiApiKeyEncrypted !== "string" || s.aiApiKeyEncrypted.length > 2000)) return false;
    if (s.aiApiKeyProvider !== undefined && !["", ...PROVIDERS].includes(s.aiApiKeyProvider)) return false;
    if (s.aiApiKeyEndpoint !== undefined && (typeof s.aiApiKeyEndpoint !== "string" || s.aiApiKeyEndpoint.length > 300)) return false;
    if (s.aiAzureDeployment !== undefined && (typeof s.aiAzureDeployment !== "string" || s.aiAzureDeployment.length > 100)) return false;
    if (s.aiAzureEndpoint !== undefined) {
      if (typeof s.aiAzureEndpoint !== "string" || s.aiAzureEndpoint.length > 300) return false;
      if (s.aiAzureEndpoint && normalizeAzureEndpoint(s.aiAzureEndpoint) === null) return false;
    }
    if (s.aiM365TenantId !== undefined && (typeof s.aiM365TenantId !== "string" || (s.aiM365TenantId && !TENANT_PATTERN.test(s.aiM365TenantId)))) return false;
    if (s.aiM365ClientId !== undefined && (typeof s.aiM365ClientId !== "string" || (s.aiM365ClientId && !CLIENT_ID_PATTERN.test(s.aiM365ClientId)))) return false;
    if (s.aiWebSite !== undefined && !Object.prototype.hasOwnProperty.call(SITES, s.aiWebSite)) return false;
    if (s.aiWebUrl !== undefined) {
      if (typeof s.aiWebUrl !== "string" || s.aiWebUrl.length > 500) return false;
      if (s.aiWebUrl && normalizeSiteUrl(s.aiWebUrl) === null) return false;
    }
    if (s.aiWebAutoSend !== undefined && typeof s.aiWebAutoSend !== "boolean") return false;
    if (s.aiWebDeviceSso !== undefined && typeof s.aiWebDeviceSso !== "boolean") return false;
    return true;
  },

  init: function (api) {

    const m365 = createM365Client(api);
    const copilotWeb = createCopilotWeb(api);

    // Encrypt any plaintext aiApiKey before it reaches disk; never write plaintext credentials.
    api.registerSettingsTransformer(function (settings) {
      // A new key is tied to the provider selected when it was entered (see keyForProvider).
      // The settings window can resend a key it already saved, so only a changed key
      // moves the binding; otherwise the stored binding is kept, whatever the caller sent.
      const current = api.getSettings();
      const isNewKey = Boolean(settings.aiApiKey) && settings.aiApiKey !== getApiKey(current);
      settings.aiApiKeyProvider = isNewKey
        ? (PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : "")
        : (current.aiApiKeyProvider || "");
      // An Azure OpenAI key is also tied to the endpoint it was entered for, so
      // changing the endpoint later never sends the saved key to another server.
      // A key saved before an endpoint was set is tied to the first one entered,
      // and typing the key in again (even the same one) ties it to the endpoint
      // set now. The settings window sends a typed key once and then forgets it.
      const newEndpoint = normalizeAzureEndpoint(settings.aiAzureEndpoint || "") || "";
      if (settings.aiApiKeyProvider !== "azure") {
        delete settings.aiApiKeyEndpoint;
      } else if (settings.aiApiKey) {
        settings.aiApiKeyEndpoint = newEndpoint;
      } else {
        settings.aiApiKeyEndpoint = keyEndpoint(current) || newEndpoint;
      }
      if (settings.aiApiKey) {
        const encrypted = api.encryptCredential(settings.aiApiKey);
        if (encrypted) settings.aiApiKeyEncrypted = encrypted;
      }
      delete settings.aiApiKey; // Always remove plaintext from the saved copy
      return settings;
    });

    // Retrieves the API key from either the new encrypted field or the old plaintext field.
    function getApiKey(settings) {
      if (settings.aiApiKey) return settings.aiApiKey;
      if (settings.aiApiKeyEncrypted) return api.decryptCredential(settings.aiApiKeyEncrypted) || "";
      return "";
    }

    // Returns the saved key only if it was entered for this provider, so switching
    // providers never sends one provider's key to another provider's server.
    function keyForProvider(settings, provider) {
      if (!keyBelongsTo(settings, provider)) return "";
      return getApiKey(settings);
    }

    async function callAiChat(prompt, aiSettings) {
      const { aiProvider, aiApiKey, aiModelName } = aiSettings;

      if (aiProvider === "m365copilot") {
        const s = api.getSettings();
        return m365.chat(prompt, s.aiM365TenantId, s.aiM365ClientId);
      }

      if (aiProvider === "copilotweb") {
        return copilotWeb.chat(prompt, api.getSettings());
      }

      if (aiProvider === "azure") {
        // Azure OpenAI v1 API: the "model" is the name of your deployment.
        const s = api.getSettings();
        const endpoint = normalizeAzureEndpoint(s.aiAzureEndpoint || "");
        const resp = await fetchWithTimeout(endpoint + "/openai/v1/chat/completions", {
          method: "POST",
          headers: { "api-key": aiApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ model: s.aiAzureDeployment, messages: [{ role: "user", content: prompt }] }),
        }, REQUEST_TIMEOUT_MS, "Azure OpenAI");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Azure OpenAI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.choices?.[0]?.message?.content ?? "";
      }

      if (aiProvider === "anthropic") {
        const model = aiModelName || "claude-opus-4-6";
        const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": aiApiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
        }, REQUEST_TIMEOUT_MS, "Anthropic");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Anthropic API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.content?.[0]?.text ?? "";
      }

      if (aiProvider === "openai") {
        const model = aiModelName || "gpt-4o";
        const resp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        }, REQUEST_TIMEOUT_MS, "OpenAI");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`OpenAI API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return json.choices?.[0]?.message?.content ?? "";
      }

      // Hatz AI (OpenAI-compatible)
      const model = aiModelName || "gpt-4o";
      const resp = await fetchWithTimeout("https://ai.hatz.ai/v1/chat/completions", {
        method: "POST",
        headers: { "X-API-Key": aiApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: prompt }], model }),
      }, REQUEST_TIMEOUT_MS, "Hatz AI");
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Hatz AI error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
      }
      const json = await resp.json();
      return json.choices?.[0]?.message?.content ?? "";
    }

    // One step of a tool-calling conversation (see tool-chat.js): returns the
    // AI's text and any lookups it wants run. Azure OpenAI, OpenAI and Anthropic only.
    async function callAiTools(req, provider, aiApiKey, aiModelName) {
      if (provider === "azure" || provider === "openai") {
        const s = api.getSettings();
        const url = provider === "azure"
          ? normalizeAzureEndpoint(s.aiAzureEndpoint || "") + "/openai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
        const model = provider === "azure" ? s.aiAzureDeployment : (aiModelName || "gpt-4o");
        const headers = provider === "azure"
          ? { "api-key": aiApiKey, "Content-Type": "application/json" }
          : { "Authorization": `Bearer ${aiApiKey}`, "Content-Type": "application/json" };
        const label = provider === "azure" ? "Azure OpenAI" : "OpenAI";
        const resp = await fetchWithTimeout(url, {
          method: "POST", headers, body: JSON.stringify(toolChat.toOpenAiBody(req, model)),
        }, REQUEST_TIMEOUT_MS, label);
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`${label} error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        return toolChat.fromOpenAiResponse(await resp.json());
      }
      if (provider === "anthropic") {
        const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": aiApiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify(toolChat.toAnthropicBody(req, aiModelName || "claude-opus-4-6")),
        }, REQUEST_TIMEOUT_MS, "Anthropic");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Anthropic API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        return toolChat.fromAnthropicResponse(await resp.json());
      }
      throw new Error("This AI provider can't look things up by itself.");
    }

    async function fetchAiModels(aiProvider, aiApiKey) {
      if (aiProvider === "openai") {
        const resp = await fetchWithTimeout("https://api.openai.com/v1/models", {
          headers: { "Authorization": `Bearer ${aiApiKey}` },
        }, REQUEST_TIMEOUT_MS, "OpenAI");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`OpenAI API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return (json.data || [])
          .filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id || ""))
          .sort((a, b) => (b.created || 0) - (a.created || 0))
          .map((m) => ({ value: m.id, label: m.id }));
      }

      if (aiProvider === "anthropic") {
        const resp = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
          headers: { "x-api-key": aiApiKey, "anthropic-version": "2023-06-01" },
        }, REQUEST_TIMEOUT_MS, "Anthropic");
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Anthropic API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
        }
        const json = await resp.json();
        return (json.data || []).map((m) => ({
          value: m.id,
          label: m.display_name ? `${m.display_name} (${m.id})` : m.id,
        }));
      }

      // Hatz AI
      const resp = await fetchWithTimeout("https://ai.hatz.ai/v1/chat/models", {
        headers: { "X-API-Key": aiApiKey },
      }, REQUEST_TIMEOUT_MS, "Hatz AI");
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`API error ${resp.status}${body ? ": " + body.substring(0, 200) : ""}`);
      }
      const json = await resp.json();
      const raw = Array.isArray(json) ? json : (json.data || json.models || []);
      return raw
        .map((m) => {
          if (typeof m === "string") return { value: m, label: m };
          const value = m?.name || m?.id;
          const label = m?.display_name ? `${m.display_name} (${value})` : value;
          return value ? { value, label } : null;
        })
        .filter(Boolean);
    }

    // Returns an error message if the selected provider isn't fully configured, else null.
    function configError(provider, settings, aiApiKey) {
      const notConfigured = "No AI provider configured. Add your API key in Settings → AI Features.";
      if (!PROVIDERS.includes(provider)) return notConfigured;
      if (provider === "m365copilot") {
        if (!m365.status(settings.aiM365TenantId, settings.aiM365ClientId)) {
          return "Not signed in to Microsoft 365. Enter your tenant and client IDs and click Sign in under Settings → AI Features.";
        }
        return null;
      }
      if (provider === "copilotweb") {
        if (!siteFor(settings).url) return "Enter the chat site's address in Settings → AI Features.";
        return null;
      }
      if (!aiApiKey && provider === "azure" && settings.aiApiKeyProvider === "azure" && keyEndpoint(settings)) {
        return "The saved API key was entered for " + keyEndpoint(settings) + ". Enter the API key again in Settings → AI Features to use it with this endpoint.";
      }
      if (!aiApiKey) return notConfigured;
      if (provider === "azure") {
        if (!normalizeAzureEndpoint(settings.aiAzureEndpoint || "")) return "Enter your Azure OpenAI endpoint in Settings → AI Features.";
        if (!settings.aiAzureDeployment) return "Enter your Azure OpenAI deployment name in Settings → AI Features.";
      }
      return null;
    }

    // Runs a prompt and treats a blank answer as an error, so an empty reply
    // never silently replaces the user's text.
    async function runPrompt(prompt, aiSettings, aiApiKey) {
      const text = await callAiChat(prompt, Object.assign({}, aiSettings, { aiApiKey }));
      if (typeof text !== "string" || !text.trim()) throw new Error("The AI provider returned an empty reply. Try again.");
      return text;
    }

    api.handle("suggest", async function ({ text, ticketContext, customInstructions, settings: aiSettings }) {
      const provider = aiSettings?.aiProvider;
      const current = api.getSettings();
      const aiApiKey = keyForProvider(current, provider);
      const notReady = aiSettings ? configError(provider, current, aiApiKey) : "No AI provider configured.";
      if (notReady) return { error: notReady };
      const safeText = (text || "").substring(0, MAX_NOTES_CHARS);
      let safeContext = (ticketContext || "").substring(0, MAX_CONTEXT_CHARS);
      // Chat websites take shorter prompts: drop ticket context before the user's text.
      const limit = promptLimit(provider, current);
      const fixedLength = safeText.length + MAX_INSTRUCTIONS_CHARS + 2000;
      if (fixedLength + safeContext.length > limit) safeContext = safeContext.substring(0, Math.max(0, limit - fixedLength));
      const safeInstructions = (customInstructions || "").substring(0, MAX_INSTRUCTIONS_CHARS);
      const contextSection =
        safeContext.trim().length > 20
          ? "\n\nFor background, here are the existing ticket notes for context (do not repeat or summarize these — they are reference only):\n\n" +
            safeContext.trim() + "\n\n---\n\n"
          : "";
      const instructionsSection = safeInstructions.trim()
        ? "\nAdditional user instructions: " + safeInstructions.trim() + "\n"
        : "";
      const prompt =
        "You are a professional writing assistant for an IT help desk. " +
        "Improve the following text for clarity, grammar, and professionalism.\n\n" +
        "CRITICAL — preserve the original voice and intended audience:\n" +
        "- If the text addresses a client directly (has a salutation or uses second-person \"you\"/\"your\"), keep it as a second-person client-facing message. Do NOT rewrite it as a third-person internal note.\n" +
        "- If the text is an internal note (uses third person, refers to \"the client\", \"the user\", or \"they\"), keep it as a third-person internal note. Do NOT convert it to second person.\n\n" +
        "Do not use em-dashes or en-dashes — use commas, periods, or hyphens instead. " +
        "Do not add, include, or preserve any signature, sign-off, closing line, or contact information at the end.\n" +
        instructionsSection +
        "Reply with only the improved text, no preamble, no labels, no explanation." +
        contextSection +
        "\n\nText to improve:\n\n" + safeText;
      try {
        return { result: await runPrompt(prompt, aiSettings, aiApiKey) };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("summarize", async function ({ text, settings: aiSettings }) {
      const provider = aiSettings?.aiProvider;
      const current = api.getSettings();
      const aiApiKey = keyForProvider(current, provider);
      const notReady = aiSettings ? configError(provider, current, aiApiKey) : "No AI provider configured.";
      if (notReady) return { error: notReady };
      const safeText = (text || "").substring(0, Math.min(MAX_NOTES_CHARS + MAX_CONTEXT_CHARS, promptLimit(provider, current) - 500));
      const prompt =
        "Summarize the following service desk ticket conversation and notes into a concise bullet-point summary. " +
        "Capture the key issue, actions taken, and current status. " +
        "Do not use em-dashes or en-dashes in your response — use commas, periods, or hyphens instead. " +
        "Reply with only the summary, no preamble:\n\n" + safeText;
      try {
        return { result: await runPrompt(prompt, aiSettings, aiApiKey) };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    // Generic entry point for other plugins: runs a prompt they built against the
    // provider and model chosen in Settings → AI Features, so they don't need
    // their own keys or provider code.
    api.handle("complete", async function (data) {
      const prompt = data && typeof data.prompt === "string" ? data.prompt : "";
      if (!prompt.trim()) return { error: "Nothing to send to the AI." };
      if (prompt.length > MAX_COMPLETE_CHARS) return { error: "The request is too large to send to the AI." };
      const current = api.getSettings();
      const provider = current.aiProvider;
      const aiApiKey = keyForProvider(current, provider);
      const notReady = configError(provider, current, aiApiKey);
      if (notReady) return { error: notReady };
      try {
        return { result: await runPrompt(prompt, { aiProvider: provider, aiModelName: current.aiModelName }, aiApiKey) };
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    // Tool calling for other plugins (the AI Assistant). data: see tool-chat.js.
    // Returns { text, toolCalls } or { error }. Check "info" (tools: true) first.
    api.handle("chat-tools", async function (data) {
      const current = api.getSettings();
      const provider = current.aiProvider;
      if (!toolChat.supportsTools(provider)) return { error: "The selected AI provider can't look things up by itself." };
      const aiApiKey = keyForProvider(current, provider);
      const notReady = configError(provider, current, aiApiKey);
      if (notReady) return { error: notReady };
      const req = toolChat.checkRequest(data);
      if (req.error) return req;
      try {
        const res = await callAiTools(req, provider, aiApiKey, current.aiModelName);
        if (!res.toolCalls.length && !res.text.trim()) throw new Error("The AI provider returned an empty reply. Try again.");
        return res;
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    // The most characters a prompt for this provider can have.
    function promptLimit(provider, settings) {
      return provider === "copilotweb" ? siteFor(settings).maxPromptChars : MAX_COMPLETE_CHARS;
    }

    // Lets other plugins adapt to the provider: a chat website gets one request
    // per question (each one may need the user to press Send) and a shorter prompt.
    api.handle("info", async function () {
      const current = api.getSettings();
      const provider = current.aiProvider;
      const website = provider === "copilotweb";
      return { provider, singleRequest: website, maxPromptChars: promptLimit(provider, current), tools: toolChat.supportsTools(provider) };
    });

    api.handle("copilotweb-open", async function () {
      try {
        return copilotWeb.open(api.getSettings());
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("copilotweb-sso-status", async function () {
      return copilotWeb.deviceSsoStatus();
    });

    api.handle("copilotweb-sign-out", async function () {
      return copilotWeb.signOut();
    });

    api.handle("m365-status", async function () {
      const s = api.getSettings();
      return m365.status(s.aiM365TenantId, s.aiM365ClientId) || { account: null };
    });

    api.handle("m365-sign-in", async function (data) {
      const s = api.getSettings();
      const tenant = (data && typeof data.tenant === "string" && data.tenant) || s.aiM365TenantId;
      const clientId = (data && typeof data.clientId === "string" && data.clientId) || s.aiM365ClientId;
      try {
        return await m365.signIn(tenant, clientId);
      } catch (err) {
        return { error: err.message || String(err) };
      }
    });

    api.handle("m365-sign-out", async function () {
      await m365.signOut();
      return { ok: true };
    });

    api.handle("get-models", async function ({ aiProvider }) {
      const aiApiKey = keyForProvider(api.getSettings(), aiProvider);
      // Azure deployments and Microsoft 365 Copilot have no model list to choose from.
      if (!["hatz", "openai", "anthropic"].includes(aiProvider) || !aiApiKey) {
        return { error: "No provider configured" };
      }
      try {
        const models = await fetchAiModels(aiProvider, aiApiKey);
        if (!models.length) return { error: "Empty model list returned" };
        return { models };
      } catch (err) {
        api.log("get-models failed:", err);
        return { error: err.message || String(err) };
      }
    });
  },
};

// True if the saved API key was entered for this provider. Keys saved before keys
// were tied to a provider are treated as belonging to the original three providers.
function keyBelongsTo(settings, provider) {
  if (settings.aiApiKeyProvider) {
    if (settings.aiApiKeyProvider !== provider) return false;
    if (provider !== "azure") return true;
    const boundTo = keyEndpoint(settings);
    return !boundTo || boundTo === normalizeAzureEndpoint(settings.aiAzureEndpoint || "");
  }
  return ["hatz", "openai", "anthropic"].includes(provider);
}

// The Azure endpoint a saved key belongs to, or "" when the key is not an Azure
// key or no endpoint is set yet. Keys saved before the tie was recorded belong to
// the endpoint saved with them.
function keyEndpoint(settings) {
  if (!settings || settings.aiApiKeyProvider !== "azure") return "";
  if (typeof settings.aiApiKeyEndpoint === "string" && settings.aiApiKeyEndpoint) return settings.aiApiKeyEndpoint;
  return normalizeAzureEndpoint(settings.aiAzureEndpoint || "") || "";
}

// Accepts an Azure OpenAI / Foundry resource URL with or without a trailing path
// (e.g. https://contoso.openai.azure.com/ or .../openai/v1/) and returns its origin,
// or null if it isn't an https URL.
function normalizeAzureEndpoint(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}
