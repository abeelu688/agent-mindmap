import * as vscode from "vscode";
import { installMcpServerConfig, showMcpInstallHint } from "../mcp/mcpConfig";
import { getStoreDir, getWorkspacePath } from "../paths";

export async function commandInstallMcp(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = getWorkspacePath();
  if (!workspaceRoot) {
    void vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder before installing the MCP server."
    );
    return;
  }
  const storeDir = getStoreDir();
  try {
    const result = await installMcpServerConfig(context.extensionPath, workspaceRoot, storeDir);
    showMcpInstallHint(result);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(
      `Agent Mind Map: Failed to install MCP server. Build the extension first (npm run build). ${detail}`
    );
  }
}
