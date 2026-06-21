import type {
  McpIndexFile,
  MergeRecord,
  OntologyIndex,
  OntologyRecord,
  ProjectSummary,
  SearchHit,
  SegmentEquivalence,
  SessionRecord,
} from "../storeTypes";

/**
 * Unified storage surface for agent-mindmap.
 *
 * Implementations:
 *   - `SqliteStore` (single-machine, SQLite-backed via `@vscode/sqlite3`)
 *   - `RemoteStore` (team mode, HTTP client to a Go team service)
 *   - `TeamStore` (team mode, write-through wrapper combining local
 *     SqliteStore + RemoteStore + PushQueue)
 *
 * Single-machine code constructs a store via `bootstrapStore()`. The MCP
 * server receives a `Store` via its handler context and never touches the
 * filesystem directly, so the same binary runs unchanged in both modes.
 *
 * Write semantics:
 *   - `upsertRecord` is idempotent on `(projectSlug, sessionId)` and bumps the
 *     project revision inside its transaction. Returns the new revision.
 *   - `bumpProjectRevision` is atomic and monotonic. SQLite uses native
 *     transactions.
 *   - Merge records (concept-trie / deterministic / llm-refined / llm-cache)
 *     and ontology records are written through this interface by the
 *     extension's analysis + merge pipelines. `SqliteStore` stores them as
 *     opaque JSON in the `kv` table. `deleteProjectRecords` +
 *     `clearOntologyCache` back the "clear analysis cache" maintenance command.
 */
export interface Store {
  listProjectSummaries(): Promise<ProjectSummary[]>;
  getProjectRevision(projectSlug: string): Promise<number>;
  /** Cached record count from the index, or undefined if not tracked. */
  getProjectRecordCount(projectSlug: string): Promise<number | undefined>;

  getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined>;
  listRecordsForProject(projectSlug: string): Promise<SessionRecord[]>;
  /** All records across all projects. Used by cross-project lookup (jump-to-
   * origin) and the deterministic merge worker. */
  listAllRecords(): Promise<SessionRecord[]>;
  upsertRecord(record: SessionRecord): Promise<{ revision: number }>;
  /** Delete every session row for a project; reset the project's count + last
   * analyzed at. Keeps the project row (revision monotonicity for team-mode
   * push-queue correctness). Used by `clearProjectAnalysisCache`. */
  deleteProjectRecords(projectSlug: string): Promise<void>;

  readConceptTrieMerge(): Promise<MergeRecord | undefined>;
  writeConceptTrieMerge(merge: MergeRecord): Promise<void>;
  readDeterministicMerge(): Promise<MergeRecord | undefined>;
  writeDeterministicMerge(merge: MergeRecord): Promise<void>;
  readLlmRefinedMerge(): Promise<MergeRecord | undefined>;
  writeLlmRefinedMerge(merge: MergeRecord): Promise<void>;
  readLlmMergeCache(cacheKey: string): Promise<MergeRecord | undefined>;
  writeLlmMergeCache(cacheKey: string, merge: MergeRecord): Promise<void>;

  readOntologyIndex(): Promise<OntologyIndex | undefined>;
  writeOntologyIndex(index: OntologyIndex): Promise<void>;
  readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined>;
  writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void>;
  /** Drop every `ontology-cache:*` kv entry + the `ontology-index` entry. */
  clearOntologyCache(): Promise<void>;

  readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]>;

  bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile>;

  /**
   * Server-side search (team mode only). Delegates to the Go token-scorer
   * on the team service via `POST /v1/projects/:slug/search`. Returns
   * `undefined` when the store does not support remote search (single-machine
   * mode uses `searchProjectRecords` directly via the MCP server's local
   * index).
   */
  search?(
    projectSlug: string,
    query: string,
    limit: number,
    opts?: { verbose?: boolean }
  ): Promise<SearchHit[]>;
}
