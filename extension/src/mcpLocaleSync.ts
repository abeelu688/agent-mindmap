import * as vscode from "vscode";
import { writeMcpLocaleFile } from "@agent-mindmap/core";
import { resolveUiLocale } from "./l10n/uiTranslate";
import { getStoreDir } from "./paths";

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
  const locale = resolveUiLocale();
  const storeDir = getStoreDir();
  await writeMcpLocaleFile({
    storeDir,
    locale,
    onError: (err) => {
      void vscode.window.showWarningMessage(
        `Agent Mind Map: failed to sync MCP locale file: ${err.message}`
      );
    },
  });
}

/** Returns true when the configuration change affects MCP locale sync. */
export function affectsMcpLocale(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration("agentMindmap.ui.locale");
}
