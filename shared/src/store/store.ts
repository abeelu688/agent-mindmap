import type {
  McpIndexFile,
  MergeRecord,
  ProjectSummary,
  SegmentEquivalence,
  SessionRecord,
} from "../storeTypes";

/**
 * Unified storage surface for agent-mindmap.
 *
 * Two implementations ship from day one:
 *   - `JsonFsStore` (single-machine, file-based JSON layout)
 *   - `RemoteStore` (team mode, HTTP client to a Postgres-backed service; TBD)
 *
 * Single-machine code constructs a `JsonFsStore` directly. The MCP server
 * receives a `Store` via its handler context and never touches the filesystem
 * itself, so the same binary runs unchanged in both modes.
 *
 * Write semantics:
 *   - `upsertRecord` is idempotent on `(projectSlug, sessionId)`. Returns the
 *     new project revision.
 *   - `bumpProjectRevision` is atomic and monotonic. SQLite/Postgres use
 *     native transactions; the JSON file impl uses a lock file.
 *   - Clients never write merge snapshots or ontology records through this
 *     interface. Those are produced by a deterministic worker.
 */
export interface Store {
  listProjectSummaries(): Promise<ProjectSummary[]>;
  getProjectRevision(projectSlug: string): Promise<number>;
  /** Cached record count from the index, or undefined if not tracked. */
  getProjectRecordCount(projectSlug: string): Promise<number | undefined>;

  getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined>;
  listRecordsForProject(projectSlug: string): Promise<SessionRecord[]>;
  upsertRecord(record: SessionRecord): Promise<{ revision: number }>;

  readConceptTrieMerge(): Promise<MergeRecord | undefined>;
  readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]>;

  bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile>;
}
