import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

/** Cursor project slug under `~/.cursor/projects/`. */

export function workspaceToSlug(fsPath: string): string {
  if (process.platform === "win32") {
    // Cursor on Windows: d-cursor-projects-repo (drive + path, `\` `_` → `-`)

    return fsPath

      .toLowerCase()

      .replace(/^([a-z]):\\/, "$1-")

      .replace(/\\/g, "-")

      .replace(/_/g, "-");
  }

  // Unix: strip leading `/`, `/` → `-` (e.g. home-example-cursor-airecorder)

  return fsPath.replace(/^\//, "").replace(/\//g, "-");
}

/**

 * Inverse of {@link workspaceToSlug} — best-effort reconstruction of the

 * original filesystem path. Cursor's slug format is lossy (any path segment

 * that contains `-` becomes ambiguous), so this is only for display.

 */

export function slugToWorkspacePath(slug: string): string {
  if (process.platform === "win32") {
    if (/^[a-z]-/.test(slug)) {
      const drive = slug[0].toUpperCase();

      const rest = slug.slice(2).replace(/-/g, "\\");

      return `${drive}:\\${rest}`;
    }

    return slug.replace(/-/g, "\\");
  }

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
