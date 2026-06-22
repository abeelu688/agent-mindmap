/**
 * `syncAiContext` use case — refresh the MCP index for the workspace.
 *
 * Thin wrapper: the actual `refreshMcpIndexForWorkspace` logic lives in the
 * extension (it has vscode deps for workspace resolution). The use case
 * accepts a `McpRefresher` port that the extension implements.
 */
import type { Logger } from "../ports/Logger";
import type { HostAccess } from "../ports/HostAccess";

export type McpRefresher = {
  /** Refresh the MCP index for a project. Returns undefined if no sessions. */
  refreshMcpIndex(
    projectSlug: string
  ): Promise<{ projectSlug: string; recordCount: number } | undefined>;
};

export type SyncAiContextDeps = {
  hostAccess: HostAccess;
  logger: Logger;
  mcpRefresher: McpRefresher;
};

export type SyncAiContextResult = {
  projectSlug: string;
  recordCount: number;
};

/**
 * Sync AI context for the current workspace.
 *
 * Returns `undefined` when there is no workspace or no analyzed sessions.
 */
export async function syncAiContext(
  deps: SyncAiContextDeps
): Promise<SyncAiContextResult | undefined> {
  const host = await deps.hostAccess.getActiveHost();
  const slug = deps.hostAccess.getWorkspaceSlug(host);
  if (!slug) {
    deps.logger.warn("No workspace folder open");
    return undefined;
  }

  const result = await deps.mcpRefresher.refreshMcpIndex(slug);
  if (!result) {
    deps.logger.warn("No analyzed sessions for this project");
    return undefined;
  }

  return result;
}
