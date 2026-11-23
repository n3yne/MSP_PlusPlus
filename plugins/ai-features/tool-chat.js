"use strict";

// Tool calling ("function calling") for other plugins, such as the AI Assistant.
//
// A caller sends a provider-neutral conversation:
//   system:   string
//   messages: [{ role: "user", text }
//              { role: "assistant", text, toolCalls: [{ id, name, arguments }] }
//              { role: "tool", id, name, content }]
//   tools:    [{ name, description, parameters (JSON schema) }]
//   toolChoice: "auto" (default) or "none" (answer now, no more lookups)
// and gets back { text, toolCalls: [{ id, name, arguments }] }.
//
// This file turns that into each provider's request and reads the reply. It
// only describes tools: running them is up to the caller, so AI Features never
// touches the data the tools reach.

const TOOL_PROVIDERS = ["azure", "openai", "anthropic"];

const MAX_TOOLS = 25;
const MAX_MESSAGES = 80;
const MAX_REQUEST_CHARS = 150000;
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_TOOL_CALL_ID_CHARS = 100;

function supportsTools(provider) {
  return TOOL_PROVIDERS.includes(provider);
}

// Checks and copies what a plugin sent, or returns { error }.
function checkRequest(data) {
  const d = data && typeof data === "object" ? data : {};
  const system = typeof d.system === "string" ? d.system : "";
  const tools = Array.isArray(d.tools) ? d.tools : [];
  const messages = Array.isArray(d.messages) ? d.messages : [];
  if (!messages.length) return { error: "Nothing to send to the AI." };
  if (tools.length > MAX_TOOLS) return { error: "Too many tools for one request." };
  if (messages.length > MAX_MESSAGES) return { error: "The conversation is too long. Start a new chat." };

  const cleanTools = [];
  for (const t of tools) {
    if (!t || typeof t !== "object" || !TOOL_NAME_PATTERN.test(String(t.name || ""))) return { error: "A tool has an invalid name." };
    const parameters = t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} };
    cleanTools.push({ name: t.name, description: String(t.description || "").substring(0, 2000), parameters });
  }

  const cleanMessages = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return { error: "A message is invalid." };
    if (m.role === "user") {
      cleanMessages.push({ role: "user", text: String(m.text || "") });
    } else if (m.role === "assistant") {
      const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
      const cleanCalls = [];
      for (const c of calls) {
        if (!c || !TOOL_NAME_PATTERN.test(String(c.name || ""))) return { error: "A tool call has an invalid name." };
        const id = String(c.id || "").substring(0, MAX_TOOL_CALL_ID_CHARS);
        if (!id) return { error: "A tool call has no id." };
        const args = c.arguments && typeof c.arguments === "object" && !Array.isArray(c.arguments) ? c.arguments : {};
        cleanCalls.push({ id, name: c.name, arguments: args });
      }
      cleanMessages.push({ role: "assistant", text: String(m.text || ""), toolCalls: cleanCalls });
    } else if (m.role === "tool") {
      const id = String(m.id || "").substring(0, MAX_TOOL_CALL_ID_CHARS);
      if (!id) return { error: "A tool result has no id." };
      cleanMessages.push({ role: "tool", id, name: String(m.name || ""), content: String(m.content || "") });
    } else {
      return { error: "A message has an unknown role." };
    }
  }

  const size = system.length + JSON.stringify(cleanMessages).length + JSON.stringify(cleanTools).length;
  if (size > MAX_REQUEST_CHARS) return { error: "The request is too large to send to the AI. Start a new chat." };
  return {
    system,
    messages: cleanMessages,
    tools: cleanTools,
    toolChoice: d.toolChoice === "none" ? "none" : "auto",
  };
}

// Parses tool call arguments, which OpenAI-style APIs send as a JSON string.
function parseArguments(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// ===== OpenAI / Azure OpenAI (Chat Completions) =====

function toOpenAiBody(req, model) {
  const messages = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.text });
    else if (m.role === "assistant") {
      const msg = { role: "assistant", content: m.text || null };
      if (m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        }));
      }
      messages.push(msg);
    } else {
      messages.push({ role: "tool", tool_call_id: m.id, content: m.content });
    }
  }
  const body = { model, messages };
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = req.toolChoice;
  }
  return body;
}

function fromOpenAiResponse(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!msg) return { text: "", toolCalls: [] };
  const toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
    .filter((c) => c && c.function && TOOL_NAME_PATTERN.test(String(c.function.name || "")))
    .map((c, i) => ({
      id: String(c.id || "call_" + i).substring(0, MAX_TOOL_CALL_ID_CHARS),
      name: c.function.name,
      arguments: parseArguments(c.function.arguments),
    }));
  return { text: typeof msg.content === "string" ? msg.content : "", toolCalls };
}

// ===== Anthropic (Messages) =====

function toAnthropicBody(req, model) {
  const messages = [];
  for (const m of req.messages) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      const content = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) content.push({ type: "tool_use", id: c.id, name: c.name, input: c.arguments });
      messages.push({ role: "assistant", content: content.length ? content : [{ type: "text", text: "(no reply)" }] });
    } else {
      // Tool results go in a user turn; consecutive results share one turn.
      const block = { type: "tool_result", tool_use_id: m.id, content: m.content };
      const last = messages[messages.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        messages.push({ role: "user", content: [block] });
      }
    }
  }
  const body = { model, max_tokens: 4096, messages };
  if (req.system) body.system = req.system;
  if (req.tools.length) {
    body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    body.tool_choice = { type: req.toolChoice };
  }
  return body;
}

function fromAnthropicResponse(json) {
  const blocks = json && Array.isArray(json.content) ? json.content : [];
  const text = blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
  const toolCalls = blocks
    .filter((b) => b && b.type === "tool_use" && TOOL_NAME_PATTERN.test(String(b.name || "")))
    .map((b, i) => ({
      id: String(b.id || "toolu_" + i).substring(0, MAX_TOOL_CALL_ID_CHARS),
      name: b.name,
      arguments: parseArguments(b.input),
    }));
  return { text, toolCalls };
}

module.exports = {
  TOOL_PROVIDERS,
  supportsTools,
  checkRequest,
  parseArguments,
  toOpenAiBody,
  fromOpenAiResponse,
  toAnthropicBody,
  fromAnthropicResponse,
};
