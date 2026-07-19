import * as vscode from "vscode";
import {
  normalizeRepoUriToSlug,
  checkRepoPrerequisites as coreCheckRepoPrerequisites,
} from "@agent-mindmap/core";

export type ProjectMode = "workspace" | "repo";

/** Read the configured project mode; unknown/missing values coerce to `"workspace"`. */
export function getProjectMode(): ProjectMode {
  const raw = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("project.mode", "workspace");
  return raw === "repo" ? "repo" : "workspace";
}

export { normalizeRepoUriToSlug } from "@agent-mindmap/core";

export type RepoPrereqResult = { ok: true; uri: string } | { ok: false; reason: string };

/**
 * Check the two repo-mode prerequisites for a workspace folder (TEAM_MODE.md
 * §Q5 rule 1): (a) git repo with `origin` resolving, (b) folder IS the repo
 * root. Returns the origin URI on success, or a reason string on failure.
 */
export async function checkRepoPrerequisites(folder: string): Promise<RepoPrereqResult> {
  return coreCheckRepoPrerequisites(folder);
}

export type RepoGateFailure = { folder: string; reason: string };
export type RepoGateResult = { broken: false } | { broken: true; failures: RepoGateFailure[] };

/** folder fsPath -> repo slug. Populated by {@link checkRepoModeGate}. */
const repoSlugCache = new Map<string, string>();

/**
 * Run the repo-mode prerequisite gate against ALL workspace folders. On
 * success, populate {@link repoSlugCache} with `{folder -> repoSlug}`. On any
 * failure, return `{broken: true, failures}` (cache is cleared first; failing
 * folders are NOT entered). Idempotent - re-running re-derives the whole set.
 */
export async function checkRepoModeGate(): Promise<RepoGateResult> {
  repoSlugCache.clear();
  const folders = vscode.workspace.workspaceFolders ?? [];
  const failures: RepoGateFailure[] = [];
  for (const folder of folders) {
    const fsPath = folder.uri.fsPath;
    const res = await coreCheckRepoPrerequisites(fsPath);
    if (res.ok) {
      repoSlugCache.set(fsPath, normalizeRepoUriToSlug(res.uri));
    } else {
      failures.push({ folder: fsPath, reason: res.reason });
    }
  }
  if (failures.length > 0) {
    return { broken: true, failures };
  }
  return { broken: false };
}

/** Sync lookup of a folder's cached repo slug. `undefined` if gate hasn't run or folder failed. */
export function getCachedRepoSlug(folder: string): string | undefined {
  return repoSlugCache.get(folder);
}

export const __testing = {
  repoSlugCache,
  normalizeRepoUriToSlug,
};
