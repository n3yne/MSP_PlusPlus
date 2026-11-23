import globals from "globals";
import js from "@eslint/js";

export default [
  js.configs.recommended,

  // Main process + Node.js files
  {
    files: ["src/main/**/*.js", "src/plugin-system/**/*.js", "scripts/**/*.js", "plugins/**/main.js", "plugins/ai-features/m365.js", "plugins/ai-features/copilot-web.js", "plugins/ai-features/http.js", "plugins/ai-features/tool-chat.js", "plugins/freshservice/assistant-tools.js", "plugins/note-backup/legacy-import.js", "plugins/password-vault/vault-*.js", "native/windows-hello/index.js", "native/windows-sso/index.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off",
    },
  },

  // Renderer scripts (browser — no import/export, no Node globals)
  {
    files: ["src/windows/**/*.js", "plugins/**/renderer.js", "plugins/**/settings.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        // Electron exposes this via contextBridge — not a standard browser global
        ClipboardItem: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "no-console": "off",
    },
  },

  // Shared by the window (script tag) and the tests (require)
  {
    files: ["src/shared/**/*.js", "plugins/tree-tabs/renderer.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...globals.browser, module: "writable" },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
    },
  },

  // Tests
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },

  // Global ignores
  {
    ignores: ["node_modules/**", "dist/**", "docs/**", "plugins/password-vault/argon2.min.js"],
  },
];
