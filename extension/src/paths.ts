import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/** Cursor project slug: strip leading `/`, join segments with `-`. */
export function workspaceToSlug(fsPath: string): string {
  return fsPath.replace(/^\//, "").replace(/\//g, "-");
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

export function getTranscriptsDir(slug?: string): string | undefined {
  const resolvedSlug = slug ?? getWorkspaceSlug();
  if (!resolvedSlug) {
    return undefined;
  }
  return path.join(getProjectsRoot(), resolvedSlug, "agent-transcripts");
}
