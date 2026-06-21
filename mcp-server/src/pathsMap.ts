import * as fs from "fs";
import * as path from "path";
import { resolveStoreDir } from "@agent-mindmap/shared";

export type ProjectMode = "workspace" | "repo";

const WORKSPACE_MAP_FILENAME = "workspace-paths.json";
const REPO_MAP_FILENAME = "repo-paths.json";
const MCP_MODE_FILENAME = "mcp-mode.json";

export type ResolvePathResult =
  | { kind: "ok"; absPath: string }
  | { kind: "miss"; slug: string; mode: ProjectMode }
  | { kind: "empty-rel-path" };

/**
 * Reads `~/.agent-mindmap/mcp-mode.json` written by the extension. Missing
 * file / unknown value → `"workspace"` (backward-compat: pre-P2.7 behavior
 * was path-based, equivalent to workspace mode).
 */
export function readProjectMode(storeDirOverride?: string): ProjectMode {
  const storeDir = storeDirOverride ?? resolveStoreDir();
  try {
    const raw = fs.readFileSync(path.join(storeDir, MCP_MODE_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as { mode?: unknown };
    if (parsed.mode === "repo") return "repo";
  } catch {
    // missing / invalid → workspace
  }
  return "workspace";
}

/**
 * Resolve a `CodeReference.path` (relative to the project root) against the
 * local clone for the given project slug, using the paths map the extension
 * writes (`workspace-paths.json` / `repo-paths.json`).
 *
 * **Read-on-miss pattern** (TEAM_MODE.md §Q5 rule 8): the relevant map is
 * loaded once into `cache`; on a slug lookup miss, the map file is re-read
 * from disk (the extension may have rewritten it since startup) and the
 * lookup retried. If the re-read still misses, the slug is reported as
 * unresolvable so the caller (Q4 staleness) can surface a VS Code
 * notification suggesting "Refresh Repo Paths".
 *
 * No `fs.watch` — the read-on-miss keeps a manual refresh effective without
 * a file watcher.
 */
export function createPathsResolver(storeDirOverride?: string): {
  resolvePath: (slug: string, relPath: string) => ResolvePathResult;
  resetCache: () => void;
} {
  const storeDir = storeDirOverride ?? resolveStoreDir();
  let cachedMode: ProjectMode | undefined;
  let cachedMap: Record<string, string> | undefined;

  function loadMap(mode: ProjectMode): Record<string, string> {
    const filename = mode === "repo" ? REPO_MAP_FILENAME : WORKSPACE_MAP_FILENAME;
    try {
      const raw = fs.readFileSync(path.join(storeDir, filename), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    } catch {
      // missing / invalid → empty map
    }
    return {};
  }

  function currentMode(): ProjectMode {
    if (cachedMode === undefined) {
      cachedMode = readProjectMode(storeDir);
    }
    return cachedMode;
  }

  function currentMap(): Record<string, string> {
    if (cachedMap === undefined) {
      cachedMap = loadMap(currentMode());
    }
    return cachedMap;
  }

  function resolvePath(slug: string, relPath: string): ResolvePathResult {
    if (!relPath) {
      return { kind: "empty-rel-path" };
    }
    const mode = currentMode();
    const map = currentMap();
    if (slug in map) {
      return { kind: "ok", absPath: path.join(map[slug]!, relPath) };
    }
    // Read-on-miss: re-read the map file in case the extension rewrote it.
    cachedMap = loadMap(mode);
    if (slug in cachedMap) {
      return { kind: "ok", absPath: path.join(cachedMap[slug]!, relPath) };
    }
    return { kind: "miss", slug, mode };
  }

  function resetCache(): void {
    cachedMode = undefined;
    cachedMap = undefined;
  }

  return { resolvePath, resetCache };
}

export const __testing = {
  WORKSPACE_MAP_FILENAME,
  REPO_MAP_FILENAME,
  MCP_MODE_FILENAME,
};
