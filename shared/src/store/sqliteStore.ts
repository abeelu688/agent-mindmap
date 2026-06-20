import { promisify } from "util";
import { MCP_INDEX_SCHEMA_VERSION } from "../storeLayout";
import { looksLikeSessionRecord, validateAndBackfillRecord } from "./recordValidate";
import { applySchema } from "./sqliteSchema";
import type {
  McpIndexFile,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
  ProjectSummary,
  SegmentEquivalence,
  SessionRecord,
} from "../storeTypes";
import type { Store } from "./store";

/**
 * Minimal surface of `@vscode/sqlite3`'s `Database` we depend on.
 *
 * Typed locally so `shared/` doesn't need a type-only dep on
 * `@vscode/sqlite3` (which lives in `extension/node_modules`). The runtime
 * module is loaded via `require("@vscode/sqlite3")` at construction time —
 * same pattern as `extension/src/transcript/cursorStateDb.ts`.
 */
type Sqlite3Database = {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): Promise<void>;
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
};

type Sqlite3Static = {
  Database: new (path: string, callback?: (err: Error | null) => void) => Sqlite3Database;
  OPEN_READWRITE: number;
  OPEN_CREATE: number;
};

type SqlBindValue = string | number | bigint | Buffer | null;

const KV_CONCEPT_TRIE = "concept-trie";
const KV_ONTOLOGY_INDEX = "ontology-index";
const KV_ONTOLOGY_CACHE_PREFIX = "ontology-cache:";

function ontologyCacheKey(cacheKey: string): string {
  return `${KV_ONTOLOGY_CACHE_PREFIX}${cacheKey}`;
}

/**
 * Lazy-load `@vscode/sqlite3` from the consumer's node_modules.
 *
 * Uses dynamic `import()` so vitest's `resolve.alias` can intercept it
 * (vitest does not rewrite `require()` calls in transformed modules).
 * At runtime in the extension bundle, esbuild leaves `@vscode/sqlite3`
 * external (`--external:@vscode/sqlite3`), so the import resolves from
 * `extension/node_modules`.
 */
async function loadSqlite3(): Promise<Sqlite3Static> {
  const mod = (await import("@vscode/sqlite3")) as unknown as Sqlite3Static;
  return mod;
}

async function openDatabase(dbPath: string): Promise<unknown> {
  const sqlite3 = await loadSqlite3();
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA busy_timeout = 3000");
        applySchema(db);
        resolve(db);
      } catch (applyErr) {
        db.close();
        reject(applyErr);
      }
    });
  });
}

function promisifyDb(db: unknown): Sqlite3Database {
  const raw = db as {
    exec(sql: string): void;
    run(sql: string, params?: unknown[], cb?: (err: Error | null) => void): void;
    get(sql: string, params?: unknown[], cb?: (err: Error | null, row: unknown) => void): void;
    all(sql: string, params?: unknown[], cb?: (err: Error | null, rows: unknown[]) => void): void;
    close(cb?: (err: Error | null) => void): void;
  };
  const run = promisify(raw.run.bind(raw)) as (
    sql: string,
    params?: SqlBindValue[]
  ) => Promise<void>;
  const get = promisify(raw.get.bind(raw)) as <T>(
    sql: string,
    params?: SqlBindValue[]
  ) => Promise<T | undefined>;
  const all = promisify(raw.all.bind(raw)) as <T>(
    sql: string,
    params?: SqlBindValue[]
  ) => Promise<T[]>;
  const close = promisify(raw.close.bind(raw)) as () => Promise<void>;
  return {
    exec: (sql: string) => raw.exec(sql),
    run,
    get,
    all,
    close,
  };
}

/**
 * SQLite-backed `Store` for single-machine mode.
 *
 * One DB file (`store.db`) holds all projects, sessions, and kv blobs.
 * `upsertRecord` writes the record and bumps the project revision in a single
 * `db.transaction` (no lock file, no EEXIST-retry — the DB engine serializes
 * the transaction).
 *
 * `readConceptTrieMerge` / `readLatestSegmentEquivalences` read from the `kv`
 * table; the deterministic worker writes through `writeConceptTrieMerge` /
 * `writeOntologyRecord` (methods on this class, not on the `Store` interface,
 * since the worker is the only writer).
 */
export class SqliteStore implements Store {
  private readonly db: Promise<Sqlite3Database>;

  constructor(dbPath: string) {
    this.db = openDatabase(dbPath).then((opened) => promisifyDb(opened));
  }

  /** For tests: close the underlying DB handle. */
  async close(): Promise<void> {
    const db = await this.db;
    await db.close();
  }

  private async run(sql: string, params: SqlBindValue[] = []): Promise<void> {
    const db = await this.db;
    await db.run(sql, params);
  }

  private async get<T>(sql: string, params: SqlBindValue[] = []): Promise<T | undefined> {
    const db = await this.db;
    return db.get<T>(sql, params);
  }

  private async all<T>(sql: string, params: SqlBindValue[] = []): Promise<T[]> {
    const db = await this.db;
    return db.all<T>(sql, params);
  }

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    const rows = await this.all<{
      project_slug: string;
      project_path: string | null;
      record_count: number;
      last_analyzed_at: number | null;
      last_built_at: number;
    }>(
      `SELECT project_slug, project_path, record_count, last_analyzed_at, last_built_at FROM projects`
    );
    if (!rows.length) {
      return [];
    }
    const summaries: ProjectSummary[] = rows.map((row) => ({
      projectSlug: row.project_slug,
      projectPath: row.project_path ?? undefined,
      sessionCount: row.record_count,
      lastAnalyzedAt: row.last_analyzed_at ?? row.last_built_at,
    }));
    summaries.sort((a, b) => b.lastAnalyzedAt - a.lastAnalyzedAt);
    return summaries;
  }

  async getProjectRevision(projectSlug: string): Promise<number> {
    const row = await this.get<{ revision: number }>(
      `SELECT revision FROM projects WHERE project_slug = ?`,
      [projectSlug]
    );
    return row?.revision ?? 0;
  }

  async getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    const row = await this.get<{ record_count: number }>(
      `SELECT record_count FROM projects WHERE project_slug = ?`,
      [projectSlug]
    );
    return row?.record_count;
  }

  async getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    const row = await this.get<{ record_json: string }>(
      `SELECT record_json FROM sessions WHERE project_slug = ? AND session_id = ?`,
      [projectSlug, sessionId]
    );
    if (!row) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.record_json);
    } catch {
      return undefined;
    }
    if (!looksLikeSessionRecord(parsed)) {
      return undefined;
    }
    return validateAndBackfillRecord(parsed);
  }

  async listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    const rows = await this.all<{ record_json: string }>(
      `SELECT record_json FROM sessions WHERE project_slug = ?`,
      [projectSlug]
    );
    const out: SessionRecord[] = [];
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.record_json);
      } catch {
        continue;
      }
      if (!looksLikeSessionRecord(parsed)) {
        continue;
      }
      const validated = validateAndBackfillRecord(parsed);
      if (validated) {
        out.push(validated);
      }
    }
    return out;
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    const { projectSlug, sessionId } = record.meta;
    const recordJson = JSON.stringify(record);
    const analyzedAt = record.meta.analyzedAt;
    const transcriptSha256 = record.meta.transcriptSha256 ?? null;
    const projectPath = record.meta.projectPath ?? null;
    const now = Date.now();

    const db = await this.db;
    // Single serialized transaction: insert project if missing, upsert session,
    // then bump revision + recompute counts/last_analyzed_at. @vscode/sqlite3
    // does not expose db.transaction() directly; emulate with BEGIN/COMMIT.
    await db.run(`BEGIN`);
    try {
      await db.run(
        `INSERT INTO projects (project_slug, project_path, revision, record_count, last_analyzed_at, last_built_at)
         VALUES (?, ?, 0, 0, NULL, ?)
         ON CONFLICT(project_slug) DO NOTHING`,
        [projectSlug, projectPath, now]
      );
      await db.run(
        `INSERT INTO sessions (project_slug, session_id, transcript_sha256, analyzed_at, record_json)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_slug, session_id) DO UPDATE SET
           transcript_sha256 = excluded.transcript_sha256,
           analyzed_at = excluded.analyzed_at,
           record_json = excluded.record_json`,
        [projectSlug, sessionId, transcriptSha256, analyzedAt, recordJson]
      );
      await db.run(
        `UPDATE projects SET
           revision = revision + 1,
           record_count = (SELECT COUNT(*) FROM sessions WHERE project_slug = ?),
           last_analyzed_at = COALESCE(
             (SELECT MAX(analyzed_at) FROM sessions WHERE project_slug = ?),
             last_analyzed_at
           ),
           last_built_at = ?,
           project_path = COALESCE(?, project_path)
         WHERE project_slug = ?`,
        [projectSlug, projectSlug, now, projectPath, projectSlug]
      );
      await db.run(`COMMIT`);
    } catch (err) {
      await db.run(`ROLLBACK`).catch(() => {});
      throw err;
    }

    const revision = await this.getProjectRevision(projectSlug);
    return { revision };
  }

  async readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    const row = await this.get<{ value_json: string }>(`SELECT value_json FROM kv WHERE key = ?`, [
      KV_CONCEPT_TRIE,
    ]);
    if (!row) {
      return undefined;
    }
    try {
      return JSON.parse(row.value_json) as MergeRecord;
    } catch {
      return undefined;
    }
  }

  async readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    const indexRow = await this.get<{ value_json: string }>(
      `SELECT value_json FROM kv WHERE key = ?`,
      [KV_ONTOLOGY_INDEX]
    );
    if (!indexRow) {
      return [];
    }
    let index: OntologyIndex;
    try {
      index = JSON.parse(indexRow.value_json) as OntologyIndex;
    } catch {
      return [];
    }
    if (!index?.entries?.length) {
      return [];
    }
    const candidates = index.entries
      .filter((entry) => entry.projectSlugs.includes(projectSlug))
      .sort((a, b) => b.builtAt - a.builtAt);
    for (const entry of candidates) {
      const cacheRow = await this.get<{ value_json: string }>(
        `SELECT value_json FROM kv WHERE key = ?`,
        [ontologyCacheKey(entry.cacheKey)]
      );
      if (!cacheRow) {
        continue;
      }
      try {
        const record = JSON.parse(cacheRow.value_json) as OntologyRecord;
        if (record?.segmentEquivalences?.length) {
          return record.segmentEquivalences;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  async bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    const now = Date.now();
    const lastAnalyzedAt = opts?.lastAnalyzedAt ?? null;
    const projectPath = opts?.projectPath ?? null;
    await this.run(
      `INSERT INTO projects (project_slug, project_path, revision, record_count, last_analyzed_at, last_built_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(project_slug) DO UPDATE SET
         revision = revision + 1,
         record_count = excluded.record_count,
         last_analyzed_at = COALESCE(excluded.last_analyzed_at, projects.last_analyzed_at),
         last_built_at = excluded.last_built_at,
         project_path = COALESCE(excluded.project_path, projects.project_path)`,
      [projectSlug, projectPath, recordCount, lastAnalyzedAt, now]
    );
    return this.readMcpIndexFile();
  }

  /** Reconstruct the legacy `McpIndexFile` shape from the `projects` table. */
  private async readMcpIndexFile(): Promise<McpIndexFile> {
    const rows = await this.all<{
      project_slug: string;
      project_path: string | null;
      revision: number;
      record_count: number;
      last_analyzed_at: number | null;
      last_built_at: number;
    }>(
      `SELECT project_slug, project_path, revision, record_count, last_analyzed_at, last_built_at FROM projects`
    );
    const projects: McpIndexFile["projects"] = {};
    for (const row of rows) {
      projects[row.project_slug] = {
        lastBuiltAt: row.last_built_at,
        recordCount: row.record_count,
        revision: row.revision,
        ...(row.last_analyzed_at === null ? {} : { lastAnalyzedAt: row.last_analyzed_at }),
        ...(row.project_path === null ? {} : { projectPath: row.project_path }),
      };
    }
    return {
      schemaVersion: MCP_INDEX_SCHEMA_VERSION,
      updatedAt: Date.now(),
      projects,
    };
  }

  // ─── Non-interface writer methods (used by the deterministic worker and
  //     the JSON→SQLite migration in P2.2). Not on `Store` because clients
  //     never write these through the interface. ─────────────────────────

  async writeConceptTrieMerge(merge: MergeRecord): Promise<void> {
    await this.run(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [KV_CONCEPT_TRIE, JSON.stringify(merge), Date.now()]
    );
  }

  async writeOntologyIndex(index: OntologyIndex): Promise<void> {
    await this.run(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [KV_ONTOLOGY_INDEX, JSON.stringify(index), Date.now()]
    );
  }

  async writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void> {
    await this.run(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [ontologyCacheKey(cacheKey), JSON.stringify(record), Date.now()]
    );
  }
}
