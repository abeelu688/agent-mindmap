// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/media/**",
      "**/coverage/**",
      "**/*.vsix",
      ".husky/**",
      "test/eval/.cache/**",
      "test/eval/reports/**",
      "test/fixtures/**",
      "**/*.cjs",
      "**/*.mjs",
    ],
  },

  // ── Base recommended rules ────────────────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── TypeScript files (extension + webview + tests) ────────────────────────
  {
    files: [
      "core/src/**/*.ts",
      "cli/src/**/*.ts",
      "extension/src/**/*.ts",
      "webview/src/**/*.ts",
      "shared/src/**/*.ts",
      "mcp-server/src/**/*.ts",
      "test/**/*.ts",
    ],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    settings: {
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: [
            "core/tsconfig.json",
            "cli/tsconfig.json",
            "extension/tsconfig.json",
            "webview/tsconfig.json",
            "shared/tsconfig.json",
            "mcp-server/tsconfig.json",
          ],
        },
        node: true,
      },
    },
    rules: {
      // ── Package boundary rules (A1–A9) ───────────────────────────────────
      // Enforce import direction: cli → core → shared, extension → core → shared
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // A1: core/ must not import from extension, cli, webview, mcp-server
            {
              target: "./core/src",
              from: ["./extension/src", "./cli/src", "./webview/src", "./mcp-server/src"],
              message: "core/ must not import from surface packages (rule A1)",
            },
            // A2: cli/ must not import from extension
            {
              target: "./cli/src",
              from: ["./extension/src"],
              message: "cli/ must not import from extension/src (rule A2)",
            },
            // A6: no upward imports — extension must not import from cli
            {
              target: "./extension/src",
              from: ["./cli/src"],
              message: "extension/ must not import from cli/src (rule A6)",
            },
          ],
        },
      ],
      // ── Empty catch / blocks ──────────────────────────────────────────────
      // bare `catch {}` swallows errors silently. Existing call sites use this
      // pattern intentionally for "best-effort" cleanup; allow with `warn`
      // until they're audited and given an `agentLog.debug()` entry.
      "no-empty": ["warn", { allowEmptyCatch: false }],

      // ── Console use ───────────────────────────────────────────────────────
      // Migrated to `agentLog` in Phase 1; new code should not reintroduce
      // direct `console.*` calls. Existing eval/script files still use it.
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // ── Unused variables ──────────────────────────────────────────────────
      // Allow leading-underscore convention for intentionally-unused params.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-unused-vars": "off",

      // ── Import order ──────────────────────────────────────────────────────
      "import/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "type",
          ],
          "newlines-between": "never",
        },
      ],

      // ── Style relaxations ─────────────────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "prefer-const": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "warn",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
    },
  },

  // ── Test files: even more relaxed (mocks, type assertions) ────────────────
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": "off",
    },
  },

  // ── Prettier compatibility (must come last) ───────────────────────────────
  prettierConfig
);
