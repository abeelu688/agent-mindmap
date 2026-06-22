/**
 * `listSessions` use case — discover agent chat sessions for the current workspace.
 *
 * Pure orchestration: resolve host → get scan dir → list sessions.
 * No LLM calls, no store writes.
 */
import type { HostAccess } from "../ports/HostAccess";
import type { TranscriptSession } from "../transcript/types";

export type ListSessionsDeps = {
  hostAccess: HostAccess;
};

export type ListSessionsResult = {
  sessions: TranscriptSession[];
  scanDir: string;
  projectSlug: string;
};

/**
 * List all agent chat sessions for the current workspace.
 *
 * Returns `undefined` when there is no workspace or no scan directory.
 */
export async function listSessions(
  deps: ListSessionsDeps
): Promise<ListSessionsResult | undefined> {
  const host = await deps.hostAccess.getActiveHost();
  const workspacePath = deps.hostAccess.getWorkspacePath();
  if (!workspacePath) {
    return undefined;
  }

  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir) {
    return undefined;
  }

  const slug = deps.hostAccess.getWorkspaceSlug(host);
  if (!slug) {
    return undefined;
  }

  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });

  return { sessions, scanDir, projectSlug: slug };
}
