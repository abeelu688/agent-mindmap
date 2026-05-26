import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/** Cursor project slug: strip leading `/`, join segments with `-`. */
export function workspaceToSlug(fsPath: string): string {
  return fsPath.replace(/^\//, "").replace(/\//g, "-");
}

/**
 * Inverse of {@link workspaceToSlug} — best-effort reconstruction of the
 * original filesystem path. Cursor's slug format is lossy (any path segment
 * that contains `-` becomes ambiguous), so this is only for display.
 */
export function slugToWorkspacePath(slug: string): string {
  return "/" + slug.replace(/-/g, "/");
}

export function getProjectsRoot(): string {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("projectsDir");
  if (override && override.trim()) {
    return override.trim();
  }
  return path.join(os.homedir(), ".cursor", "projects");
}

export function getWorkspaceSlug(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return workspaceToSlug(folder.uri.fsPath);
}

export function getWorkspacePath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

export function getTranscriptsDir(slug?: string): string | undefined {
  const resolvedSlug = slug ?? getWorkspaceSlug();
  if (!resolvedSlug) {
    return undefined;
  }
  return path.join(getProjectsRoot(), resolvedSlug, "agent-transcripts");
}

/**
 * Resolve the cross-project analysis library directory.
 *
 * Defaults to `~/.agent-mindmap/`, overridable via `agentMindmap.storeDir`.
 * Designed to live outside any project so a single library can span all
 * agents and all projects; the user can also point it at a sync folder
 * (iCloud / Dropbox) to share the library across machines.
 */
export function getStoreDir(): string {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("storeDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".agent-mindmap");
}

function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
