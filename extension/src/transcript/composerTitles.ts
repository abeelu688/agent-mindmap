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
}
