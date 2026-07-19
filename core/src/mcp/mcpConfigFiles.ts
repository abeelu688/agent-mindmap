/**
 * MCP server config file writers - shared by the VS Code extension and the CLI.
 *
 * The stdio MCP server has no access to VS Code APIs or the CLI runtime, so
 * the extension / CLI writes a handful of small JSON files to the store dir
 * that the MCP server reads at startup / on read-on-miss:
 *
 * - `mcp-mode.json` - "workspace" | "repo" - which paths map to consult
 * - `workspace-paths.json` - {workspaceSlug -> folderPath}
 * - `repo-paths.json` - {repoSlug -> folderPath}
 * - `mcp-locale.json` - UI locale for tool example localization
 *
 * These functions take all VS Code / CLI dependencies as parameters so they
 * can be called from either surface.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { MCP_CONFIG_FILES } from "@agent-mindmap/shared";
import { writeJsonAtomic } from "../store/atomicWrite";
import { checkRepoPrerequisites, normalizeRepoUriToSlug } from "../host/repoSlug";

export type ProjectMode = "workspace" | "repo";

export type WriteMcpConfigFilesOpts = {
  storeDir: string;
  mode: ProjectMode;
  /** Workspace folder paths to record in the maps. */
  folderPaths: string[];
  /** Slug encoder from the active host (matches `AgentHost.encodeWorkspacePath`). */
  encodeWorkspacePath: (fsPath: string) => string;
  /** Optional logger for non-fatal issues (e.g. repo slug collisions). */
  onCollision?: (slug: string, folderPath: string, existingPath: string) => void;
  /** Optional error sink; if omitted, errors are swallowed (best-effort write). */
  onError?: (err: Error) => void;
};

type PathsMap = Record<string, string>;

/**
 * Write `mcp-mode.json`, `workspace-paths.json`, and `repo-paths.json` to the
 * store dir. Idempotent - rewrites all three files wholesale on each call.
 *
 * - **workspace map**: one entry per folder, slug from `encodeWorkspacePath`.
 * - **repo map**: only folders that pass repo prerequisites; first-seen wins
 *   on slug collision. Written in both modes so a switch to repo mode doesn't
 *   start from an empty map.
 * - **mode file**: tells the MCP server which map to read.
 */
export async function writeMcpConfigFiles(opts: WriteMcpConfigFilesOpts): Promise<void> {
  const { storeDir, mode, folderPaths, encodeWorkspacePath, onCollision, onError } = opts;
  try {
    await fs.mkdir(storeDir, { recursive: true });

    const workspaceMap: PathsMap = {};
    for (const fsPath of folderPaths) {
      const slug = encodeWorkspacePath(fsPath);
      workspaceMap[slug] = fsPath;
    }
    await writeJsonAtomic(path.join(storeDir, MCP_CONFIG_FILES.workspacePaths), workspaceMap);

    const repoMap: PathsMap = {};
    for (const fsPath of folderPaths) {
      const res = await checkRepoPrerequisites(fsPath);
      if (!res.ok) {
        continue;
      }
      const slug = normalizeRepoUriToSlug(res.uri);
      if (slug in repoMap) {
        onCollision?.(slug, fsPath, repoMap[slug]!);
        continue;
      }
      repoMap[slug] = fsPath;
    }
    await writeJsonAtomic(path.join(storeDir, MCP_CONFIG_FILES.repoPaths), repoMap);

    await writeJsonAtomic(path.join(storeDir, MCP_CONFIG_FILES.mode), { mode });
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}

export type WriteMcpLocaleFileOpts = {
  storeDir: string;
  locale: string;
  onError?: (err: Error) => void;
};

/**
 * Write `mcp-locale.json` so the stdio MCP server can localize tool example
 * queries. Best-effort: errors are swallowed.
 */
export async function writeMcpLocaleFile(opts: WriteMcpLocaleFileOpts): Promise<void> {
  const { storeDir, locale, onError } = opts;
  try {
    await fs.mkdir(storeDir, { recursive: true });
    await writeJsonAtomic(path.join(storeDir, MCP_CONFIG_FILES.locale), { locale });
  } catch (err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
