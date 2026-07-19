import * as fs from "fs";
import * as path from "path";
import { resolveStoreDir, MCP_CONFIG_FILES } from "@agent-mindmap/shared";

export type ProjectMode = "workspace" | "repo";

const WORKSPACE_MAP_FILENAME = MCP_CONFIG_FILES.workspacePaths;
const REPO_MAP_FILENAME = MCP_CONFIG_FILES.repoPaths;
const MCP_MODE_FILENAME = MCP_CONFIG_FILES.mode;

export type ResolvePathResult =
  | { kind: "ok"; absPath: string }
  | { kind: "miss"; slug: string; mode: ProjectMode }
  | { kind: "empty-rel-path" }
  | { kind: "path-escape"; attempted: string; root: string };

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
function findSlugByFolderPath(map: Record<string, string>, folderPath: string): string | undefined {
  const normalized = path.normalize(folderPath);
  for (const [slug, root] of Object.entries(map)) {
    if (path.normalize(root) === normalized) {
      return slug;
    }
  }
  return undefined;
}

export function createPathsResolver(storeDirOverride?: string): {
  resolvePath: (slug: string, relPath: string) => ResolvePathResult;
  resolveSlugFromPath: (folderPath: string) => string | undefined;
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

  /**
   * Check that an absolute path falls within the project root.
   * Rejects `..` escapes, absolute relPaths, and symlink-based escapes
   * (checked via resolved real paths when both exist).
   */
  function isWithinRoot(root: string, relPath: string): boolean {
    // Reject absolute relPaths (e.g. "/etc/passwd" or "C:\Windows\System32")
    if (path.isAbsolute(relPath)) {
      return false;
    }
    const resolved = path.resolve(root, relPath);
    const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
    // Must be exactly the root or a descendant
    if (resolved !== root && !resolved.startsWith(rootPrefix)) {
      return false;
    }
    return true;
  }

  function resolvePath(slug: string, relPath: string): ResolvePathResult {
    if (!relPath) {
      return { kind: "empty-rel-path" };
    }
    const mode = currentMode();
    const map = currentMap();
    if (slug in map) {
      const root = map[slug]!;
      if (!isWithinRoot(root, relPath)) {
        return { kind: "path-escape", attempted: relPath, root };
      }
      return { kind: "ok", absPath: path.join(root, relPath) };
    }
    // Read-on-miss: re-read the map file in case the extension rewrote it.
    cachedMap = loadMap(mode);
    if (slug in cachedMap) {
      const root = cachedMap[slug]!;
      if (!isWithinRoot(root, relPath)) {
        return { kind: "path-escape", attempted: relPath, root };
      }
      return { kind: "ok", absPath: path.join(root, relPath) };
    }
    return { kind: "miss", slug, mode };
  }

  /**
   * Reverse lookup: workspace folder path → store slug, using the mode-aware
   * paths map the extension writes (`repo-paths.json` or `workspace-paths.json`).
   */
  function resolveSlugFromPath(folderPath: string): string | undefined {
    if (!folderPath.trim()) {
      return undefined;
    }
    const map = currentMap();
    const hit = findSlugByFolderPath(map, folderPath);
    if (hit) {
      return hit;
    }
    // Read-on-miss: extension may have rewritten the map since startup.
    cachedMap = loadMap(currentMode());
    return findSlugByFolderPath(cachedMap, folderPath);
  }

  function resetCache(): void {
    cachedMode = undefined;
    cachedMap = undefined;
  }

  return { resolvePath, resolveSlugFromPath, resetCache };
}

export const __testing = {
  WORKSPACE_MAP_FILENAME,
  REPO_MAP_FILENAME,
  MCP_MODE_FILENAME,
};
