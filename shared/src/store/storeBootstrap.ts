import * as fs from "fs/promises";
import * as path from "path";
import { STORE_LAYOUT } from "../storeLayout";
import { SqliteStore } from "./sqliteStore";
import type { Store } from "./store";

/**
 * Pick the right `Store` for a given store directory (P2.2 → P2.4).
 *
 * Resolution order:
 *   1. `store.db` exists → open `SqliteStore`. If it fails to open, throw —
 *      the user must repair or delete the corrupt DB.
 *      fallback (removed in P2.4).
 *   2. No `store.db` → open a fresh empty `SqliteStore`.
 *   3. On first launch after P2.4, if legacy JSON session directories are
 *      present and `store.db` is healthy, delete them (the SQLite DB is now
 *      the sole source of truth). A kv flag prevents re-deletion.
 *
 * Not in scope (per P2.2): calling this from `extension.ts` / `mcp-server`.
 * The extension's write path is still JSON-based (P1.3 unfinished), so wiring
 * bootstrap now would split the store. This helper is testable in isolation
 * and ready to call once P1.3 lands.
 */
export type StoreKind = "sqlite" | "sqlite-migrated";

export interface BootstrapResult {
  store: Store;
  kind: StoreKind;
  migrated?: boolean;
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

/**
 * Check whether legacy JSON session directories exist under `storeDir`.
 * Used to decide whether to clean up legacy files after confirming store.db
 * is healthy.
 */
async function legacyJsonSessionsExist(storeDir: string): Promise<boolean> {
  const sessionsRoot = path.join(storeDir, STORE_LAYOUT.sessionsDir);
  if (!(await pathExists(sessionsRoot))) {
    return false;
  }
  try {
    const stat = await fs.stat(sessionsRoot);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Delete legacy JSON session directories and the `.mcp-index.json` file under
 * `storeDir`. Safe to call only after confirming the SqliteStore is healthy
 * (has data). Sets a meta flag to avoid re-deletion on subsequent launches.
 */
async function deleteLegacyJsonFiles(storeDir: string, store: SqliteStore): Promise<void> {
  // Check the meta flag — only delete once.
  const alreadyDone = await store.readMetaFlag("json-cleanup-done");
  if (alreadyDone) {
    return;
  }

  // Delete the sessions directory (contains per-project subdirs with JSON files).
  const sessionsRoot = path.join(storeDir, STORE_LAYOUT.sessionsDir);
  try {
    await fs.rm(sessionsRoot, { recursive: true, force: true });
  } catch {
    // Best-effort — log but don't fail the bootstrap.
    console.warn(`[agent-mindmap] failed to delete legacy JSON sessions dir: ${sessionsRoot}`);
  }

  // Delete the MCP index file.
  const mcpIndex = path.join(storeDir, STORE_LAYOUT.mcpIndexFile);
  try {
    await fs.unlink(mcpIndex);
  } catch {
    // File may not exist — that's fine.
  }

  // Set the meta flag so we don't try again.
  await store.writeMetaFlag("json-cleanup-done", true);
}

/**
 * Construct the appropriate `Store` for `storeDir`.
 *
 * @throws If `store.db` exists but is not a valid SQLite database or cannot
 *         be opened. The caller should surface the error — the user must
 *         repair or delete the corrupt DB.
 */
export async function bootstrapStore(storeDir: string): Promise<BootstrapResult> {
  // Ensure the store directory exists before SqliteStore tries to open
  // store.db inside it — @vscode/sqlite3 returns SQLITE_CANTOPEN otherwise.
  await fs.mkdir(storeDir, { recursive: true });
  const dbPath = path.join(storeDir, "store.db");
  const dbExists = await pathExists(dbPath);

  if (dbExists) {
    if (!(await looksLikeSqliteFile(dbPath))) {
      throw new Error(
        `store.db at ${dbPath} is not a valid SQLite database. ` +
          `Delete or rename it to allow a fresh store.db to be created. ` +
          `Downgrade to pre-SQLite versions is no longer supported (P2.4).`
      );
    }
    const sqlite = new SqliteStore(dbPath);
    try {
      // Force the async open + schema apply so a corrupt-but-headered DB rejects here.
      await sqlite.listProjectSummaries();
    } catch (err) {
      try {
        await sqlite.close?.();
      } catch {
        // ignore
      }
      throw new Error(
        `SqliteStore failed to open ${dbPath}: ${
          err instanceof Error ? err.message : String(err)
        }. Delete or rename the file to allow a fresh store.db to be created. ` +
          `Downgrade to pre-SQLite versions is no longer supported (P2.4).`
      );
    }

    // Clean up legacy JSON files on first launch after P2.4.
    if (await legacyJsonSessionsExist(storeDir)) {
      await deleteLegacyJsonFiles(storeDir, sqlite);
    }

    return { store: sqlite, kind: "sqlite" };
  }

  // No DB yet. Open a fresh SqliteStore (creates the file + schema).
  const sqlite = new SqliteStore(dbPath);
  try {
    await sqlite.listProjectSummaries();
  } catch (err) {
    try {
      await sqlite.close?.();
    } catch {
      // ignore
    }
    throw new Error(
      `Could not create a fresh SqliteStore at ${dbPath}: ${
        err instanceof Error ? err.message : String(err)
      }.`
    );
  }

  // Clean up legacy JSON files if they exist (pre-P2.4 installs that somehow
  // lack a store.db — unlikely but harmless to handle).
  if (await legacyJsonSessionsExist(storeDir)) {
    await deleteLegacyJsonFiles(storeDir, sqlite);
    return { store: sqlite, kind: "sqlite-migrated", migrated: true };
  }

  return { store: sqlite, kind: "sqlite" };
}
