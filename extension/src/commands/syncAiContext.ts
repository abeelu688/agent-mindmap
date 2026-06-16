import * as vscode from "vscode";
import { refreshMcpIndexForWorkspace } from "../mcp/mcpConfig";
import { getWorkspacePath } from "../paths";

export async function commandSyncAiContext(): Promise<void> {
  const projectPath = getWorkspacePath();
  if (!projectPath) {
    void vscode.window.showWarningMessage(
      "Agent Mind Map: Open a workspace folder before syncing AI context."
    );
    return;
  }
  const result = await refreshMcpIndexForWorkspace();
  if (!result) {
    void vscode.window.showWarningMessage(
      "Agent Mind Map: No analyzed sessions for this project. Run **Analyze All Sessions (Current Project)** first."
    );
    return;
  }
  void vscode.window.showInformationMessage(
    `Agent Mind Map: AI context index refreshed for ${result.projectSlug} (${result.recordCount} session(s)). MCP tools will use the latest analyzed history.`
  );
}
