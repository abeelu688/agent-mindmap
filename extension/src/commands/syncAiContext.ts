import { refreshMcpIndexForWorkspace } from "../mcp/mcpConfig";
import { t } from "../l10n/uiTranslate";
import { notifyInfo, notifyWarning } from "../notify";
import { getWorkspacePath } from "../paths";

export async function commandSyncAiContext(): Promise<void> {
  const projectPath = getWorkspacePath();
  if (!projectPath) {
    notifyWarning(
      t(
        "ui.mcp.sync.noWorkspace",
        "Agent Mind Map: Open a workspace folder before syncing AI context."
      )
    );
    return;
  }
  const result = await refreshMcpIndexForWorkspace();
  if (!result) {
    notifyWarning(
      t(
        "ui.mcp.sync.noSessions",
        "Agent Mind Map: No analyzed sessions for this project. Run **Analyze All Sessions (Current Project)** first."
      )
    );
    return;
  }
  notifyInfo(
    t(
      "ui.mcp.sync.success",
      "Agent Mind Map: AI context index refreshed for {0} ({1} session(s)). MCP tools will use the latest analyzed history.",
      result.projectSlug,
      String(result.recordCount)
    )
  );
}
