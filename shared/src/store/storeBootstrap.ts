import * as fs from "fs/promises";
import * as path from "path";
import { STORE_LAYOUT } from "../storeLayout";
import { JsonFsStore } from "./jsonFsStore";
import { migrateJsonToSqlite, type MigrationResult } from "./migrateJsonToSqlite";
import { SqliteStore } from "./sqliteStore";
import type { Store } from "./store";

/**
 * Pick the right `Store` for a given store directory (P2.2).
 *
 * Resolution order:
 *   1. `store.db` exists → open `SqliteStore`. If it fails to open, fall back
 *      to `JsonFsStore` (read-only over the still-present JSON files) and
 *      surface a warning. The user can downgrade or fix the DB.
 *   2. No `store.db`, but legacy JSON sessions exist → open a fresh
 *      `SqliteStore`, run {@link migrateJsonToSqlite}, return it. Original
 *      JSON files are left on disk for downgrade safety.
 *   3. No `store.db`, no JSON (fresh install) → open a fresh empty
 *      `SqliteStore`.
 *
 * Not in scope (per P2.2): calling this from `extension.ts` / `mcp-server`.
 * The extension's write path is still JSON-based (P1.3 unfinished), so wiring
 * bootstrap now would split the store. This helper is testable in isolation
 * and ready to call once P1.3 lands.
 */
export type StoreKind = "sqlite" | "sqlite-migrated" | "sqlite-fallback-json" | "json";

export interface BootstrapResult {
  store: Store;
  kind: StoreKind;
  migrated?: boolean;
  migration?: MigrationResult;
  warning?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap pre-flight check: a valid SQLite database file starts with the 16-byte
 * magic header `"SQLite format 3\0"`. We check this BEFORE handing the path to
 * `@vscode/sqlite3` because the native binding throws an uncatchable
 * `Napi::Error` (crashing the process) when asked to open a file that is not a
 * SQLite database. Catching that fallback at the JS layer is impossible, so we
 * avoid triggering it.
 *
 * Returns `true` for files that look like SQLite (including genuinely corrupt
 * ones with a valid header — those are rare and surface as a real error on
 * open, which is acceptable). Returns `false` for missing files, empty files,
 * or files with a different magic.
 */
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "utf8");

async function looksLikeSqliteFile(dbPath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dbPath, "r");
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, 16, 0);
    return bytesRead === 16 && header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function jsonSessionsExist(storeDir: string): Promise<boolean> {
  const sessionsRoot = path.join(storeDir, STORE_LAYOUT.sessionsDir);
  if (!(await pathExists(sessionsRoot))) {
    return false;
  }
  try {
    const stat = await fs.stat(sessionsRoot);
    if (!stat.isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  // Treat an existing sessions dir (even if empty) as "legacy layout present".
  // Migration of an empty dir is a no-op (0 sessions), which is harmless and
  // lets the DB become the source of truth from the first launch.
  return true;
}

/**
 * Construct the appropriate `Store` for `storeDir`, running the JSON→SQLite
 * migration on first launch when legacy JSON files are present.
 */
export async function bootstrapStore(storeDir: string): Promise<BootstrapResult> {
  const dbPath = path.join(storeDir, "store.db");
  const dbExists = await pathExists(dbPath);

  if (dbExists) {
    if (!(await looksLikeSqliteFile(dbPath))) {
      // The file exists but is not a SQLite database. Do NOT hand it to
      // @vscode/sqlite3 — the native binding throws an uncatchable Napi::Error
      // and would crash the process. Fall back to JsonFsStore instead.
      return {
        store: new JsonFsStore(storeDir),
        kind: "sqlite-fallback-json",
        warning: `store.db at ${dbPath} is not a valid SQLite database. Falling back to JsonFsStore (read-only over legacy JSON). Delete or repair store.db to retry SQLite.`,
      };
    }
    try {
      const sqlite = new SqliteStore(dbPath);
      // Force the async open + schema apply so a corrupt-but-headered DB rejects here.
      await sqlite.listProjectSummaries();
      return { store: sqlite, kind: "sqlite" };
    } catch (err) {
      const warning = `SqliteStore failed to open ${dbPath}: ${
        err instanceof Error ? err.message : String(err)
      }. Falling back to JsonFsStore (read-only over legacy JSON).`;
      return {
        store: new JsonFsStore(storeDir),
        kind: "sqlite-fallback-json",
        warning,
      };
    }
  }

  // No DB yet. Open a fresh SqliteStore (creates the file + schema), then
  // migrate if legacy JSON is present.
  const sqlite = new SqliteStore(dbPath);
  try {
    await sqlite.listProjectSummaries();
  } catch (err) {
    // Could not even create/open the fresh DB — fall back to JSON if present,
    // otherwise rethrow (nothing else we can do).
    if (await jsonSessionsExist(storeDir)) {
      return {
        store: new JsonFsStore(storeDir),
        kind: "sqlite-fallback-json",
        warning: `Could not open a fresh SqliteStore at ${dbPath}: ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to JsonFsStore.`,
      };
    }
    throw err;
  }

  if (await jsonSessionsExist(storeDir)) {
    const migration = await migrateJsonToSqlite(storeDir, sqlite);
    return { store: sqlite, kind: "sqlite-migrated", migrated: true, migration };
  }

  return { store: sqlite, kind: "sqlite" };
}
