/**
 * SQLite schema for the single-machine store (`store.db`).
 *
 * Three tables per `TEAM_MODE.md` §SQLite schema:
 *   - `projects`: one row per analyzed project. Mirrors the JSON
 *     `.mcp-index.json` entries (revision, record_count, last_analyzed_at,
 *     project_path, last_built_at).
 *   - `sessions`: one row per `SessionRecord`. `record_json` holds the full
 *     record as JSON; the record is read whole or not at all, so no
 *     partial-column updates.
 *   - `kv`: generic JSON-blob store for merge snapshot (`concept-trie`),
 *     ontology index, and per-cacheKey ontology records. Same payload shapes
 *     as the JSON file layout, just keyed.
 *
 * Schema creation is idempotent (`CREATE TABLE IF NOT EXISTS`); running it
 * against an already-initialized DB is a no-op.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  project_slug     TEXT PRIMARY KEY,
  project_path     TEXT,
  revision         INTEGER NOT NULL DEFAULT 0,
  record_count     INTEGER NOT NULL DEFAULT 0,
  last_analyzed_at INTEGER,
  last_built_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  project_slug      TEXT NOT NULL REFERENCES projects(project_slug),
  session_id        TEXT NOT NULL,
  transcript_sha256 TEXT,
  analyzed_at       INTEGER NOT NULL,
  record_json       TEXT NOT NULL,
  PRIMARY KEY (project_slug, session_id)
);

CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Apply the schema to an open `@vscode/sqlite3` Database.
 *
 * `db` is typed as `unknown` here to avoid pulling the `@vscode/sqlite3` type
 * (which lives in `extension/node_modules` and isn't resolvable from
 * `shared/` at type-check time). Callers pass the real `Database` instance;
 * `db.exec` is the only method used.
 */
export function applySchema(db: { exec(sql: string): void }): void {
  db.exec(SCHEMA_SQL);
}
