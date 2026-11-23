"use strict";

// AI Assistant plugin: settings only. The chat lives in renderer.js; these
// settings add wording to every prompt it sends.

const MAX_INSTRUCTIONS = 2000;

module.exports = {
  defaultSettings: {
    // Tells the AI to use only the data MSP++ sends, not its own memory or
    // other data it can reach about the agent (for example Copilot's).
    aiAssistantOnlyProvidedData: false,
    // The agent's own extra instructions, added to every prompt.
    aiAssistantInstructions: "",
  },

  validateSettings: function (s) {
    if (s.aiAssistantOnlyProvidedData !== undefined && typeof s.aiAssistantOnlyProvidedData !== "boolean") return false;
    if (s.aiAssistantInstructions !== undefined &&
      (typeof s.aiAssistantInstructions !== "string" || s.aiAssistantInstructions.length > MAX_INSTRUCTIONS)) return false;
    return true;
  },

  MAX_INSTRUCTIONS,
};
