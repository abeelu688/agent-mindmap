import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { getStoreDir } from "../paths";
import { getActiveHost } from "../host";
import {
  getProjectMode,
  checkRepoPrerequisites,
  normalizeRepoUriToSlug,
} from "../host/slugDerivation";
import { mindMapLog } from "../webview/MindMapLog";
import { writeJsonAtomic } from "./atomicWrite";

const WORKSPACE_MAP_FILENAME = "workspace-paths.json";
const REPO_MAP_FILENAME = "repo-paths.json";
const MCP_MODE_FILENAME = "mcp-mode.json";

type PathsMap = Record<string, string>;

/**
 * Write `workspace-paths.json` and `repo-paths.json` to the store dir, derived
 * from the current workspace folders. Mirrors the Q2 locale-file pattern:
 * extension writes, MCP server reads.
 *
 * - **workspace map**: `{workspaceSlug → folderPath}`, one entry per workspace
 *   folder, slug from the active host's `encodeWorkspacePath` (byte-identical
 *   to the store key the extension writes sessions under).
 * - **repo map**: `{repoSlug → folderPath}`, one entry per workspace folder
 *   that passes repo-mode prerequisites, slug from the normalized git origin
 *   URI. First-seen wins on slug collision (two folders resolving to one
 *   repo — main clone + worktree); losers are logged at info.
 *
 * Both maps are rewritten wholesale on each call (idempotent). Best-effort:
 * failures are warned and swallowed.
 */
export async function writePathsMaps(): Promise<void> {
  const mode = getProjectMode();
  const storeDir = getStoreDir();
  const folders = vscode.workspace.workspaceFolders ?? [];

  try {
    await fs.mkdir(storeDir, { recursive: true });

    // Always write the workspace map (workspace mode reads it; repo mode
    // writing it is harmless and keeps it fresh for a mode switch back).
    const host = await getActiveHost();
    const workspaceMap: PathsMap = {};
    for (const folder of folders) {
      const slug = host.encodeWorkspacePath(folder.uri.fsPath);
      workspaceMap[slug] = folder.uri.fsPath;
    }
    await writeJsonAtomic(path.join(storeDir, WORKSPACE_MAP_FILENAME), workspaceMap);

    // Repo map: only folders that pass repo prerequisites. First-seen wins
    // on collision (rule 9). Written in both modes so a switch to repo mode
    // doesn't start from an empty map.
    const repoMap: PathsMap = {};
    for (const folder of folders) {
      const res = await checkRepoPrerequisites(folder.uri.fsPath);
      if (!res.ok) {
        continue;
      }
      const slug = normalizeRepoUriToSlug(res.uri);
      if (slug in repoMap) {
        mindMapLog(
          `pathsMap: repo slug "${slug}" from folder ${folder.uri.fsPath} collides with ${repoMap[slug]}; first-seen wins, skipping.`
        );
        continue;
      }
      repoMap[slug] = folder.uri.fsPath;
    }
    await writeJsonAtomic(path.join(storeDir, REPO_MAP_FILENAME), repoMap);

    // Mode propagation file so the MCP server (no VS Code API) knows which
    // map to read. Missing file → workspace (backward-compat).
    await writeJsonAtomic(path.join(storeDir, MCP_MODE_FILENAME), { mode });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(`Agent Mind Map: failed to sync paths map: ${detail}`);
  }
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

export const __testing = {
  WORKSPACE_MAP_FILENAME,
  REPO_MAP_FILENAME,
  MCP_MODE_FILENAME,
};
