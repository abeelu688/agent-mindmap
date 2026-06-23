import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { writeJsonAtomic } from "@agent-mindmap/core";
import { resolveUiLocale, type UiLocale } from "./l10n/uiTranslate";
import { getStoreDir } from "./paths";

const LOCALE_FILENAME = "mcp-locale.json";

/**
 * Write the active UI locale to `~/.agent-mindmap/mcp-locale.json` so the
 * stdio MCP server (which has no VS Code API access) can localize tool
 * example queries.
 *
 * Called on extension activate and whenever `agentMindmap.ui.locale` changes.
 * Best-effort: failures are logged to the agent debug channel and swallowed
 * (the MCP server falls back to English when the file is missing).
 */
export async function syncMcpLocaleFile(): Promise<void> {
  const locale: UiLocale = resolveUiLocale();
  const storeDir = getStoreDir();
  try {
    await fs.promises.mkdir(storeDir, { recursive: true });
    await writeJsonAtomic(path.join(storeDir, LOCALE_FILENAME), { locale });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(
      `Agent Mind Map: failed to sync MCP locale file: ${detail}`
    );
  }
}

/** Returns true when the configuration change affects MCP locale sync. */
export function affectsMcpLocale(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration("agentMindmap.ui.locale");
}
