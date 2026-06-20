import * as fs from "fs";
import * as path from "path";
import { resolveStoreDir } from "@agent-mindmap/shared";

/**
 * Locales the MCP server can localize tool-description examples for.
 *
 * Must mirror {@link UiLocale} in `extension/src/l10n/uiTranslate.ts`. The
 * extension writes one of these values (or `en` as default) to
 * `~/.agent-mindmap/mcp-locale.json`; we read it at startup. A test in
 * `test/mcpLocale.test.ts` asserts the union stays in sync with the
 * extension's `UiLocale`.
 */
export type McpLocale = "en" | "zh-cn" | "ja" | "ko" | "pt-br" | "es" | "de" | "fr" | "hi" | "id";

export const MCP_LOCALES: readonly McpLocale[] = [
  "en",
  "zh-cn",
  "ja",
  "ko",
  "pt-br",
  "es",
  "de",
  "fr",
  "hi",
  "id",
];

const LOCALE_FILENAME = "mcp-locale.json";

function isMcpLocale(value: unknown): value is McpLocale {
  return typeof value === "string" && (MCP_LOCALES as readonly string[]).includes(value);
}

/**
 * Read the locale the extension wrote to `mcp-locale.json`.
 *
 * - Missing file / unreadable / unknown value → `"en"` (English-only examples).
 * - Called once at server startup; not hot-reloaded.
 *
 * `storeDirOverride` is for tests; production passes no override and we use
 * {@link resolveStoreDir}.
 */
export function resolveMcpLocale(storeDirOverride?: string): McpLocale {
  const storeDir = storeDirOverride ?? resolveStoreDir();
  const filePath = path.join(storeDir, LOCALE_FILENAME);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as { locale?: unknown };
    if (isMcpLocale(parsed.locale)) {
      return parsed.locale;
    }
  } catch {
    // Missing file, invalid JSON, or permission error — fall back to English.
  }
  return "en";
}
