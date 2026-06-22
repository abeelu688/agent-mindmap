import { syncAiContext } from "@agent-mindmap/core";
import { t } from "../l10n/uiTranslate";
import { notifyInfo, notifyWarning } from "../notify";
import { buildHostAccess, buildLogger } from "../adapters/coreUseCaseDeps";
import { refreshMcpIndexForWorkspace } from "../mcp/mcpConfig";

export async function commandSyncAiContext(): Promise<void> {
  const result = await syncAiContext({
    hostAccess: buildHostAccess(),
    logger: buildLogger(),
    mcpRefresher: {
      async refreshMcpIndex(_projectSlug) {
        return refreshMcpIndexForWorkspace();
      },
    },
  });
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
