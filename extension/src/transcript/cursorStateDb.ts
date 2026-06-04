import { promisify } from "util";

type SqlBindValue = string | number | bigint | Buffer | null;

type Sqlite3Database = import("@vscode/sqlite3").Database;
type Sqlite3Static = typeof import("@vscode/sqlite3");

let loadFailed = false;
let loadFailedWarned = false;
let sqlite3Module: Sqlite3Static | undefined;

const openDbs = new Map<string, Sqlite3Database>();

function warnLoadFailed(err: unknown): void {
  if (loadFailedWarned) {
    return;
  }
  loadFailedWarned = true;
  console.warn("[agent-mindmap] @vscode/sqlite3 failed to load:", err);
}

function loadSqlite3(): Sqlite3Static | undefined {
  if (loadFailed) {
    return undefined;
  }
  if (sqlite3Module) {
    return sqlite3Module;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sqlite3Module = require("@vscode/sqlite3") as Sqlite3Static;
    return sqlite3Module;
  } catch (err) {
    loadFailed = true;
    warnLoadFailed(err);
    return undefined;
  }
}

function openReadonlyStateDb(dbPath: string): Promise<Sqlite3Database | undefined> {
  const existing = openDbs.get(dbPath);
  if (existing) {
    return Promise.resolve(existing);
  }

  const sqlite3 = loadSqlite3();
  if (!sqlite3) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READONLY,
      (err: Error | null) => {
        if (err) {
          console.warn(
            `[agent-mindmap] failed to open Cursor state.vscdb (${dbPath}):`,
            err
          );
          resolve(undefined);
          return;
        }
        db.run("PRAGMA busy_timeout = 3000", (err: Error | null) => {
          if (err) {
            console.warn("[agent-mindmap] PRAGMA busy_timeout failed:", err);
          }
        });
        openDbs.set(dbPath, db);
        resolve(db);
      }
    );
  });
}

export function clearStateDbBackend(): void {
  for (const db of openDbs.values()) {
    try {
      db.close();
    } catch {
      // ignore close errors during cache invalidation
    }
  }
  openDbs.clear();
}

export function closeStateDb(): void {
  clearStateDbBackend();
}

const VALID_TABLE_RE = /^(ItemTable|cursorDiskKV)$/;

export async function queryStateDb<T extends Record<string, unknown>>(
  dbPath: string,
  sql: string,
  params: SqlBindValue[] = []
): Promise<T[]> {
  // Validate any interpolated table names in the SQL
  const tablesInSql = sql.match(/\bFROM\s+(\w+)/ig);
  if (tablesInSql) {
    for (const fragment of tablesInSql) {
      const tableName = fragment.replace(/^FROM\s+/i, "");
      if (!VALID_TABLE_RE.test(tableName)) {
        throw new Error(`Disallowed table name in SQL: ${tableName}`);
      }
    }
  }
  const db = await openReadonlyStateDb(dbPath);
  if (!db) {
    return [];
  }

  const all = promisify(db.all.bind(db)) as (
    sql: string,
    params?: SqlBindValue[]
  ) => Promise<T[]>;

  try {
    return await all(sql, params);
  } catch (err) {
    console.warn("[agent-mindmap] state.vscdb query failed:", err);
    return [];
  }
}

const ALLOWED_TABLES = new Set(["ItemTable", "cursorDiskKV"]);

export async function getStateDbValue(
  dbPath: string,
  table: "ItemTable" | "cursorDiskKV",
  key: string
): Promise<string | undefined> {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const rows = await queryStateDb<{ value?: string }>(
    dbPath,
    `SELECT value FROM ${table} WHERE key = ?`,
    [key]
  );
  const value = rows[0]?.value;
  return typeof value === "string" ? value : undefined;
}
