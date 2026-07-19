import * as vscode from "vscode";
import { writeMcpConfigFiles, type ProjectMode } from "@agent-mindmap/core";
import { getStoreDir } from "../paths";
import { getActiveHost } from "../host";
import { getProjectMode } from "../host/slugDerivation";
import { mindMapLog } from "../webview/MindMapLog";

/**
 * Write `workspace-paths.json`, `repo-paths.json`, and `mcp-mode.json` to the
 * store dir, derived from the current workspace folders. Mirrors the Q2
 * locale-file pattern: extension writes, MCP server reads.
 *
 * Delegates the actual file writes to `writeMcpConfigFiles` in core (shared
 * with the CLI); this wrapper just injects VS Code-specific inputs (workspace
 * folders, active host, configured mode).
 *
 * Best-effort: failures are warned and swallowed.
 */
export async function writePathsMaps(): Promise<void> {
  const mode: ProjectMode = getProjectMode();
  const storeDir = getStoreDir();
  const folders = vscode.workspace.workspaceFolders ?? [];

  const host = await getActiveHost();

  await writeMcpConfigFiles({
    storeDir,
    mode,
    folderPaths: folders.map((f) => f.uri.fsPath),
    encodeWorkspacePath: (fsPath) => host.encodeWorkspacePath(fsPath),
    onCollision: (slug, folderPath, existingPath) => {
      mindMapLog(
        `pathsMap: repo slug "${slug}" from folder ${folderPath} collides with ${existingPath}; first-seen wins, skipping.`
      );
    },
    onError: (err) => {
      void vscode.window.showWarningMessage(
        `Agent Mind Map: failed to sync paths map: ${err.message}`
      );
    },
  });
}

/** Returns true when the configuration change affects paths-map sync. */
export function affectsPathsMap(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("agentMindmap.project.mode") ||
    e.affectsConfiguration("agentMindmap.host") ||
    e.affectsConfiguration("agentMindmap.projectsDir") ||
    e.affectsConfiguration("agentMindmap.claudeProjectsDir")
  );
}
