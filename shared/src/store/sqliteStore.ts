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
const KV_DETERMINISTIC_MERGE = "deterministic-merge";
const KV_LLM_REFINED_MERGE = "llm-refined-merge";
const KV_LLM_MERGE_CACHE_PREFIX = "llm-merge-cache:";
const KV_ONTOLOGY_INDEX = "ontology-index";
const KV_ONTOLOGY_CACHE_PREFIX = "ontology-cache:";
const KV_META_FLAG_PREFIX = "meta:";

function ontologyCacheKey(cacheKey: string): string {
  return `${KV_ONTOLOGY_CACHE_PREFIX}${cacheKey}`;
}

function llmMergeCacheKey(cacheKey: string): string {
  return `${KV_LLM_MERGE_CACHE_PREFIX}${cacheKey}`;
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

  /** Read + JSON-parse a `kv` value, returning `undefined` on miss/parse error. */
  private async readKv<T>(key: string): Promise<T | undefined> {
    const row = await this.get<{ value_json: string }>(`SELECT value_json FROM kv WHERE key = ?`, [
      key,
    ]);
    if (!row) {
      return undefined;
    }
    try {
      return JSON.parse(row.value_json) as T;
    } catch {
      return undefined;
    }
  }

  /** Upsert a `kv` value as JSON. */
  private async writeKv(key: string, value: unknown): Promise<void> {
    await this.run(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), Date.now()]
    );
  }

  async readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    return this.readKv<MergeRecord>(KV_CONCEPT_TRIE);
  }

  async readDeterministicMerge(): Promise<MergeRecord | undefined> {
    return this.readKv<MergeRecord>(KV_DETERMINISTIC_MERGE);
  }

  async readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return this.readKv<MergeRecord>(KV_LLM_REFINED_MERGE);
  }

  async readLlmMergeCache(cacheKey: string): Promise<MergeRecord | undefined> {
    return this.readKv<MergeRecord>(llmMergeCacheKey(cacheKey));
  }

  async readOntologyIndex(): Promise<OntologyIndex | undefined> {
    const index = await this.readKv<OntologyIndex>(KV_ONTOLOGY_INDEX);
    if (!index || index.schemaVersion !== 1 || !Array.isArray(index.entries)) {
      return undefined;
    }
    return index;
  }

  async readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined> {
    const record = await this.readKv<OntologyRecord>(ontologyCacheKey(cacheKey));
    if (!record || record.schemaVersion !== 1) {
      return undefined;
    }
    return record;
  }

  async readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    const index = await this.readOntologyIndex();
    if (!index?.entries?.length) {
      return [];
    }
    const candidates = index.entries
      .filter((entry) => entry.projectSlugs.includes(projectSlug))
      .sort((a, b) => b.builtAt - a.builtAt);
    for (const entry of candidates) {
      const record = await this.readOntologyRecord(entry.cacheKey);
      if (record?.segmentEquivalences?.length) {
        return record.segmentEquivalences;
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

  // ─── Merge + ontology writes (promoted to the `Store` interface in P2.3).
  //     The deterministic worker, the extension's merge pipelines, and the
  //     JSON→SQLite migration all write through these. ─────────────────────

  async writeConceptTrieMerge(merge: MergeRecord): Promise<void> {
    await this.writeKv(KV_CONCEPT_TRIE, merge);
  }

  async writeDeterministicMerge(merge: MergeRecord): Promise<void> {
    await this.writeKv(KV_DETERMINISTIC_MERGE, merge);
  }

  async writeLlmRefinedMerge(merge: MergeRecord): Promise<void> {
    await this.writeKv(KV_LLM_REFINED_MERGE, merge);
  }

  async writeLlmMergeCache(cacheKey: string, merge: MergeRecord): Promise<void> {
    await this.writeKv(llmMergeCacheKey(cacheKey), merge);
  }

  async writeOntologyIndex(index: OntologyIndex): Promise<void> {
    await this.writeKv(KV_ONTOLOGY_INDEX, index);
  }

  async writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void> {
    await this.writeKv(ontologyCacheKey(cacheKey), record);
  }

  async clearOntologyCache(): Promise<void> {
    // Two deletes: the index singleton + every cache entry (prefix match).
    // SQLite `LIKE` with a pattern is parameterized; the prefix contains no
    // wildcard metacharacters so this is safe.
    await this.run(`DELETE FROM kv WHERE key = ?`, [KV_ONTOLOGY_INDEX]);
    await this.run(`DELETE FROM kv WHERE key LIKE ?`, [`${KV_ONTOLOGY_CACHE_PREFIX}%`]);
  }

  async listAllRecords(): Promise<SessionRecord[]> {
    const rows = await this.all<{ record_json: string }>(`SELECT record_json FROM sessions`);
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

  async deleteProjectRecords(projectSlug: string): Promise<void> {
    const db = await this.db;
    await db.run(`BEGIN`);
    try {
      await db.run(`DELETE FROM sessions WHERE project_slug = ?`, [projectSlug]);
      // Keep the project row so revision stays monotonic (team-mode push-queue
      // correctness); reset its count + last-analyzed so listings reflect the
      // deletion. Bump revision so MCP caches invalidate.
      await db.run(
        `UPDATE projects SET
           revision = revision + 1,
           record_count = 0,
           last_analyzed_at = NULL
         WHERE project_slug = ?`,
        [projectSlug]
      );
      await db.run(`COMMIT`);
    } catch (err) {
      await db.run(`ROLLBACK`).catch(() => {});
      throw err;
    }
  }

  /**
   * Fold any pending WAL frames into the main `store.db` file and truncate the
   * WAL. Used by the re-key migration before `fs.copyFile`-based backup so the
   * backup contains all committed data without copying the WAL sidecar.
   *
   * No-op when the DB is not in WAL journal mode.
   */
  async checkpoint(): Promise<void> {
    await this.run(`PRAGMA wal_checkpoint(TRUNCATE)`);
  }

  /**
   * Read a single-machine `meta:` boolean flag from the `kv` table. Returns
   * `false` on miss / parse error / non-boolean value. Used by the re-key
   * migration's one-way guard (`rekeyed-to-repo`).
   *
   * Not on the `Store` interface — single-machine-only metadata.
   */
  async readMetaFlag(key: string): Promise<boolean> {
    const v = await this.readKv<boolean>(`${KV_META_FLAG_PREFIX}${key}`);
    return v === true;
  }

  /** Upsert a single-machine `meta:` boolean flag. */
  async writeMetaFlag(key: string, value: boolean): Promise<void> {
    await this.writeKv(`${KV_META_FLAG_PREFIX}${key}`, value);
  }

  /**
   * One-way re-key of every session under `oldSlug` to `newSlug`
   * (TEAM_MODE.md §Q5 rule 11). Runs in a single transaction: copies the
   * project row under the new slug (preserving revision / record_count /
   * last_analyzed_at / project_path), re-keys every session row
   * (`record_json` is copied verbatim — `CodeReference.path` is intentionally
   * NOT rewritten, since repo mode requires the folder to be the repo root),
   * then deletes the old project + session rows.
   *
   * Idempotent: if `oldSlug` has no sessions and no project row, the
   * transaction is a no-op. If a project row already exists under `newSlug`
   * (rare collision), its revision + record_count are added to the migrated
   * values and last_analyzed_at / last_built_at take the max.
   *
   * `sessionIds?` restricts the rewrite to a subset of sessions under
   * `oldSlug`; the project row is still re-keyed in full (the unrewritten
   * sessions are deleted under the old slug — caller's responsibility to
   * ensure that's intended).
   */
  async rekeyProjectSlug(oldSlug: string, newSlug: string, sessionIds?: string[]): Promise<void> {
    if (oldSlug === newSlug) {
      return;
    }
    const db = await this.db;
    await db.run(`BEGIN`);
    try {
      // Copy project row under new slug, merging on the rare collision.
      await db.run(
        `INSERT INTO projects (project_slug, project_path, revision, record_count, last_analyzed_at, last_built_at)
         SELECT ?, project_path, revision, record_count, last_analyzed_at, last_built_at
         FROM projects WHERE project_slug = ?
         ON CONFLICT(project_slug) DO UPDATE SET
           revision = excluded.revision + projects.revision,
           record_count = excluded.record_count + projects.record_count,
           last_analyzed_at = MAX(excluded.last_analyzed_at, projects.last_analyzed_at),
           last_built_at = MAX(excluded.last_built_at, projects.last_built_at),
           project_path = COALESCE(projects.project_path, excluded.project_path)`,
        [newSlug, oldSlug]
      );
      // Re-key sessions. INSERT OR IGNORE so a pre-existing row under
      // (newSlug, sessionId) wins (rare collision); the old row is then
      // deleted, which is correct either way.
      const sessionFilter =
        sessionIds && sessionIds.length > 0
          ? ` AND session_id IN (${sessionIds.map(() => "?").join(", ")})`
          : "";
      const sessionParams: SqlBindValue[] = sessionIds && sessionIds.length > 0 ? sessionIds : [];
      await db.run(
        `INSERT OR IGNORE INTO sessions
           (project_slug, session_id, transcript_sha256, analyzed_at, record_json)
         SELECT ?, session_id, transcript_sha256, analyzed_at, record_json
         FROM sessions WHERE project_slug = ?${sessionFilter}`,
        [newSlug, oldSlug, ...sessionParams]
      );
      await db.run(`DELETE FROM sessions WHERE project_slug = ?${sessionFilter}`, [
        oldSlug,
        ...sessionParams,
      ]);
      // Delete the old project row only when ALL its sessions were re-keyed
      // (no sessionIds filter). For partial rewrites the project row survives
      // so the unrewritten sessions keep their FK target.
      if (!sessionIds || sessionIds.length === 0) {
        await db.run(`DELETE FROM projects WHERE project_slug = ?`, [oldSlug]);
      }
      await db.run(`COMMIT`);
    } catch (err) {
      await db.run(`ROLLBACK`).catch(() => {});
      throw err;
    }
  }
}
