import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { expandHome, slugToWorkspacePath, workspaceToSlug } from "@agent-mindmap/shared";

export { workspaceToSlug, slugToWorkspacePath, expandHome };

export function getProjectsRoot(): string {
  const override = vscode.workspace.getConfiguration("agentMindmap").get<string>("projectsDir");
  if (override && override.trim()) {
    return override.trim();
  }
  return path.join(os.homedir(), ".cursor", "projects");
}

export function getWorkspaceSlug(host?: {
  getWorkspaceSlug?: () => string | undefined;
}): string | undefined {
  if (host?.getWorkspaceSlug) {
    return host.getWorkspaceSlug();
  }
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

export function getStoreDir(): string {
  const override = vscode.workspace.getConfiguration("agentMindmap").get<string>("storeDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".agent-mindmap");
}
