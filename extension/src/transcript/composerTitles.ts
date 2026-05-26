import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

/**
 * Resolve Cursor's globalStorage `state.vscdb` path.
 *
 * The user can override via the `agentMindmap.cursorStateDb` setting. When
 * empty, we fall back to platform-specific defaults that match Cursor's
 * installer layout. Returns `undefined` when no path can be determined.
 */
export function getCursorStateDbPath(): string | undefined {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("cursorStateDb");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }

  const home = os.homedir();
  switch (process.platform) {
    case "linux":
      return path.join(
        home,
        ".config",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      );
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      );
    case "win32": {
      const appData = process.env.APPDATA;
      if (!appData) {
        return undefined;
      }
      return path.join(
        appData,
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      );
    }
    default:
      return undefined;
  }
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

type CacheEntry = {
  mtimeMs: number;
  titles: Map<string, string>;
};

let cached: { path: string; entry: CacheEntry } | undefined;
let sqlPromise: Promise<SqlJsStatic> | undefined;

function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      // sql.js needs to know where sql-wasm.wasm lives. The esbuild step
      // copies it next to the bundled extension entry (dist/extension.js),
      // so resolve relative to __dirname.
      locateFile: (file) => path.join(__dirname, file),
    });
  }
  return sqlPromise;
}

/**
 * Load Cursor's sidebar composer titles keyed by agent id.
 *
 * The id matches the transcript folder name under
 * `~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl`.
 *
 * Defaults (or `"New Agent"` placeholders) are filtered out so callers can
 * cleanly fall back to other naming strategies. Any failure (missing file,
 * locked DB, WASM init error) results in an empty Map and a console warn —
 * this function never throws.
 */
export async function loadComposerTitles(): Promise<Map<string, string>> {
  const dbPath = getCursorStateDbPath();
  if (!dbPath) {
    return new Map();
  }

  let stat;
  try {
    stat = await fs.stat(dbPath);
  } catch {
    return new Map();
  }

  if (
    cached &&
    cached.path === dbPath &&
    cached.entry.mtimeMs === stat.mtimeMs
  ) {
    return cached.entry.titles;
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch (err) {
    console.warn("[agent-mindmap] failed to read Cursor state.vscdb:", err);
    return new Map();
  }

  let db: Database | undefined;
  const titles = new Map<string, string>();
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    const stmt = db.prepare(
      "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
    );
    while (stmt.step()) {
      const row = stmt.getAsObject() as { key?: string; value?: string };
      const key = row.key;
      const value = row.value;
      if (typeof key !== "string" || typeof value !== "string") {
        continue;
      }
      const id = key.slice("composerData:".length);
      if (!id) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const name = (parsed as { name?: unknown }).name;
      if (typeof name !== "string") {
        continue;
      }
      const trimmed = name.trim();
      if (!trimmed || trimmed === "New Agent") {
        continue;
      }
      titles.set(id, trimmed);
    }
    stmt.free();
  } catch (err) {
    console.warn("[agent-mindmap] failed to parse Cursor state.vscdb:", err);
    // Fall through to cache an empty map so we don't retry on every call.
  } finally {
    db?.close();
  }

  cached = {
    path: dbPath,
    entry: { mtimeMs: stat.mtimeMs, titles },
  };
  return titles;
}

/** Invalidate the in-memory cache (used by tests, mostly). */
export function clearComposerTitleCache(): void {
  cached = undefined;
  sqlPromise = undefined;
  resumableCache = undefined;
}

// ---------------------------------------------------------------------------
// Glass "resumable" composer ids
// ---------------------------------------------------------------------------
//
// Cursor 3 (Glass) tracks its live agent list in
// `composer.composerHeaders` — a JSON blob stored in ItemTable with the
// shape `{ allComposers: [{ composerId, name, ... }, ...] }`. Any
// composer whose id is in `allComposers` is openable via
// `glass.openAgentById`; ids that exist on disk (as
// `.cursor/projects/<slug>/agent-transcripts/<uuid>.jsonl`) but are
// absent from `allComposers` have been pruned by Cursor and cannot be
// resumed — `glass.openAgentById` returns `false` for them.
//
// (Earlier versions of this code mistakenly read
// `glass.localAgentProjectMembership.v1`, which holds something
// different — a per-project bookkeeping table whose membership doesn't
// correspond to "can be opened". That table happened to be non-empty
// on tested machines but its presence/absence wasn't predictive of
// `openAgentById` success.)
//
// We pre-load this set so the jump flow can short-circuit to the
// "new agent with this query" fallback without round-tripping through
// the failing command.

/**
 * Per-composer metadata pulled from `composer.composerHeaders`.
 * `workspacePath` is the absolute fsPath of the workspace that owns
 * the composer — `glass.openAgentById` only succeeds when this matches
 * the current VS Code workspace.
 */
export type ComposerHeaderMeta = {
  composerId: string;
  workspacePath?: string;
  name?: string;
  isArchived: boolean;
  type: string;
};

let composerHeadersCache:
  | {
      path: string;
      mtimeMs: number;
      headers: Map<string, ComposerHeaderMeta>;
    }
  | undefined;

/**
 * Best-effort: return the full composer header metadata map keyed by
 * composerId. Returns an empty map on any failure (so callers should
 * not treat empty as "definitely archived"). Cached on file mtime.
 */
export async function loadComposerHeaders(): Promise<
  Map<string, ComposerHeaderMeta>
> {
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return new Map();

  let stat;
  try {
    stat = await fs.stat(dbPath);
  } catch {
    return new Map();
  }
  if (
    composerHeadersCache &&
    composerHeadersCache.path === dbPath &&
    composerHeadersCache.mtimeMs === stat.mtimeMs
  ) {
    return composerHeadersCache.headers;
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return new Map();
  }

  const headers = new Map<string, ComposerHeaderMeta>();
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    const stmt = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'"
    );
    if (stmt.step()) {
      const row = stmt.getAsObject() as { value?: string };
      if (typeof row.value === "string") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.value);
        } catch {
          parsed = undefined;
        }
        const all = (parsed as { allComposers?: unknown })?.allComposers;
        if (Array.isArray(all)) {
          for (const entry of all) {
            const e = entry as Record<string, unknown>;
            const id = e.composerId;
            if (typeof id !== "string" || !id) continue;
            const ws = (e.workspaceIdentifier as
              | { uri?: { fsPath?: unknown } }
              | undefined)?.uri?.fsPath;
            headers.set(id, {
              composerId: id,
              workspacePath: typeof ws === "string" ? ws : undefined,
              name: typeof e.name === "string" ? e.name : undefined,
              isArchived: e.isArchived === true,
              type: typeof e.type === "string" ? e.type : "<missing>",
            });
          }
        }
      }
    }
    stmt.free();
  } catch (err) {
    console.warn(
      "[agent-mindmap] failed to read composer.composerHeaders:",
      err
    );
  } finally {
    db?.close();
  }

  composerHeadersCache = { path: dbPath, mtimeMs: stat.mtimeMs, headers };
  return headers;
}

/**
 * Convenience: just the resumable composerIds in the current Cursor
 * workspace registry. Includes all workspaces — callers must do their
 * own workspace-match check before calling glass.openAgentById.
 *
 * @deprecated Prefer {@link loadComposerHeaders} which carries workspace
 * info needed to route cross-workspace clicks.
 */
export async function loadGlassResumableIds(): Promise<Set<string>> {
  const headers = await loadComposerHeaders();
  const out = new Set<string>();
  for (const id of headers.keys()) out.add(id);
  return out;
}

// ---------------------------------------------------------------------------
// Glass "agent project" mapping
// ---------------------------------------------------------------------------
//
// Cursor 3's Agents panel doesn't show individual composers directly —
// it shows "agent projects" (UI groupings) and each project owns 1+
// composers. The actual command `glass.openAgentById` takes a *project
// id*, not a composerId. A composer that exists on disk but isn't in
// `glass.localAgentProjectMembership.v1` has not been promoted into a
// Glass agent project yet and therefore cannot be opened via the
// Agents UI at all.
//
// We use two tables here:
//   - glass.localAgentProjects.v1     : list of project descriptors
//   - glass.localAgentProjectMembership.v1 : composerId → projectId

export type AgentProject = {
  id: string;
  name?: string;
  workspacePath?: string;
  isArchived: boolean;
};

let agentProjectsCache:
  | {
      path: string;
      mtimeMs: number;
      projects: Map<string, AgentProject>;
      membership: Map<string, string>;
    }
  | undefined;

/**
 * Load both the project descriptors and the composerId → projectId
 * mapping in one DB read. Cached by file mtime like other loaders.
 */
export async function loadAgentProjects(): Promise<{
  projects: Map<string, AgentProject>;
  membership: Map<string, string>;
}> {
  const empty = { projects: new Map(), membership: new Map() };
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return empty;
  let stat;
  try {
    stat = await fs.stat(dbPath);
  } catch {
    return empty;
  }
  if (
    agentProjectsCache &&
    agentProjectsCache.path === dbPath &&
    agentProjectsCache.mtimeMs === stat.mtimeMs
  ) {
    return {
      projects: agentProjectsCache.projects,
      membership: agentProjectsCache.membership,
    };
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return empty;
  }

  const projects = new Map<string, AgentProject>();
  const membership = new Map<string, string>();
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));

    const projStmt = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'glass.localAgentProjects.v1'"
    );
    if (projStmt.step()) {
      const row = projStmt.getAsObject() as { value?: string };
      if (typeof row.value === "string") {
        try {
          const list = JSON.parse(row.value) as Array<Record<string, unknown>>;
          if (Array.isArray(list)) {
            for (const p of list) {
              const id = p.id;
              if (typeof id !== "string") continue;
              const ws = (p.workspace as
                | { uri?: { fsPath?: unknown } }
                | undefined)?.uri?.fsPath;
              projects.set(id, {
                id,
                name: typeof p.name === "string" ? p.name : undefined,
                workspacePath: typeof ws === "string" ? ws : undefined,
                isArchived: p.isArchived === true,
              });
            }
          }
        } catch {
          // ignore parse error
        }
      }
    }
    projStmt.free();

    const memStmt = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'glass.localAgentProjectMembership.v1'"
    );
    if (memStmt.step()) {
      const row = memStmt.getAsObject() as { value?: string };
      if (typeof row.value === "string") {
        try {
          const map = JSON.parse(row.value) as Record<string, unknown>;
          if (map && typeof map === "object") {
            for (const [composerId, projectId] of Object.entries(map)) {
              if (typeof projectId === "string") {
                membership.set(composerId, projectId);
              }
            }
          }
        } catch {
          // ignore
        }
      }
    }
    memStmt.free();
  } catch (err) {
    console.warn("[agent-mindmap] loadAgentProjects failed:", err);
  } finally {
    db?.close();
  }

  agentProjectsCache = {
    path: dbPath,
    mtimeMs: stat.mtimeMs,
    projects,
    membership,
  };
  return { projects, membership };
}

/**
 * Debug helper: dump every key in the Cursor state.vscdb whose value
 * mentions a specific composerId. Used to figure out which key actually
 * tracks "resumable" status in the current Cursor version when the
 * default `glass.localAgentProject*` lookup misses recent sessions.
 */
export async function findKeysReferencingComposer(
  composerId: string
): Promise<Array<{ table: string; key: string; valuePreview: string }>> {
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return [];
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return [];
  }
  const hits: Array<{ table: string; key: string; valuePreview: string }> = [];
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    for (const table of ["ItemTable", "cursorDiskKV"]) {
      const stmt = db.prepare(
        `SELECT key, value FROM ${table} WHERE value LIKE :needle`
      );
      stmt.bind({ ":needle": `%${composerId}%` });
      while (stmt.step()) {
        const row = stmt.getAsObject() as { key?: string; value?: string };
        if (typeof row.key !== "string" || typeof row.value !== "string") continue;
        hits.push({
          table,
          key: row.key,
          valuePreview: row.value.length > 200
            ? row.value.slice(0, 200) + "…"
            : row.value,
        });
      }
      stmt.free();
    }
  } catch (err) {
    console.warn("[agent-mindmap] findKeysReferencingComposer failed:", err);
  } finally {
    db?.close();
  }
  return hits;
}

/**
 * Debug helper: pull the raw `composer.composerHeaders` value and the
 * per-composer entry for a specific composerId. Used to understand
 * Glass's classification scheme (type: "head" / "branch" / etc.) and
 * why `glass.openAgentById` returns false for some otherwise-known
 * composers.
 */
export async function inspectComposerHeader(
  composerId: string
): Promise<{
  totalComposers: number;
  typeCounts: Record<string, number>;
  ourEntry: unknown;
  rawHeader: unknown;
}> {
  const empty = {
    totalComposers: 0,
    typeCounts: {},
    ourEntry: undefined,
    rawHeader: undefined,
  };
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return empty;
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return empty;
  }
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    const stmt = db.prepare(
      "SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'"
    );
    if (!stmt.step()) {
      stmt.free();
      return empty;
    }
    const row = stmt.getAsObject() as { value?: string };
    stmt.free();
    if (typeof row.value !== "string") return empty;
    const parsed = JSON.parse(row.value) as {
      allComposers?: Array<Record<string, unknown>>;
    };
    const composers = Array.isArray(parsed.allComposers)
      ? parsed.allComposers
      : [];
    const typeCounts: Record<string, number> = {};
    let ourEntry: unknown;
    for (const c of composers) {
      const t = typeof c.type === "string" ? (c.type as string) : "<missing>";
      typeCounts[t] = (typeCounts[t] ?? 0) + 1;
      if (c.composerId === composerId) ourEntry = c;
    }
    return {
      totalComposers: composers.length,
      typeCounts,
      ourEntry,
      rawHeader: parsed,
    };
  } catch (err) {
    console.warn("[agent-mindmap] inspectComposerHeader failed:", err);
    return empty;
  } finally {
    db?.close();
  }
}

/**
 * Debug helper: read the full JSON value stored at a given state.vscdb key.
 * Searches both ItemTable and cursorDiskKV. Returns the raw string so
 * the caller can pretty-print however it wants.
 */
export async function readStateDbKey(key: string): Promise<string | undefined> {
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return undefined;
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return undefined;
  }
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    for (const table of ["ItemTable", "cursorDiskKV"]) {
      const stmt = db.prepare(`SELECT value FROM ${table} WHERE key = :k`);
      stmt.bind({ ":k": key });
      if (stmt.step()) {
        const row = stmt.getAsObject() as { value?: string };
        stmt.free();
        if (typeof row.value === "string") return row.value;
      }
      stmt.free();
    }
  } catch (err) {
    console.warn(`[agent-mindmap] readStateDbKey(${key}) failed:`, err);
  } finally {
    db?.close();
  }
  return undefined;
}

/**
 * Debug helper: list all keys in state.vscdb that look agent/composer/glass
 * related, plus a tiny size hint per value. Helps us spot renamed keys
 * across Cursor versions without dumping the whole DB.
 */
export async function listAgentRelatedKeys(): Promise<
  Array<{ table: string; key: string; valueSize: number }>
> {
  const dbPath = getCursorStateDbPath();
  if (!dbPath) return [];
  let buffer: Buffer;
  try {
    buffer = await fs.readFile(dbPath);
  } catch {
    return [];
  }
  const out: Array<{ table: string; key: string; valueSize: number }> = [];
  let db: Database | undefined;
  try {
    const SQL = await loadSql();
    db = new SQL.Database(new Uint8Array(buffer));
    for (const table of ["ItemTable", "cursorDiskKV"]) {
      const stmt = db.prepare(
        `SELECT key, length(value) AS sz FROM ${table}
          WHERE key LIKE '%glass%'
             OR key LIKE '%composer%'
             OR key LIKE '%agent%'`
      );
      while (stmt.step()) {
        const row = stmt.getAsObject() as { key?: string; sz?: number };
        if (typeof row.key !== "string") continue;
        out.push({
          table,
          key: row.key,
          valueSize: typeof row.sz === "number" ? row.sz : 0,
        });
      }
      stmt.free();
    }
  } catch (err) {
    console.warn("[agent-mindmap] listAgentRelatedKeys failed:", err);
  } finally {
    db?.close();
  }
  return out;
}

