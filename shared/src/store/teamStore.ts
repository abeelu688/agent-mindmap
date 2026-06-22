import { RemoteStoreNotSupported } from "./remoteStore";
import type { RemoteStore } from "./remoteStore";
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
import type { Store } from "./store";

/**
 * `TeamStore` is the team-mode `Store` — a local working copy (`SqliteStore`)
 * plus a `RemoteStore` for team-service APIs (search, project list, push).
 *
 * **Extension UI + merge pipeline (local only):** session records, concept
 * trie, ontology cache, deterministic merge — all read/write via `local`.
 * Mind maps and batch merge never pull remote sessions or remote merge JSON.
 *
 * **Team service (remote only):** `listProjectSummaries`, revision/count,
 * and `search`. Push drains `local` → remote via `PushQueue` on user command.
 *
 * `upsertRecord` writes local only; push is explicit (not on every write).
 */
export class TeamStore implements Store {
  constructor(
    private readonly local: Store,
    private readonly remote: RemoteStore,
    private readonly queue: PushQueueLike
  ) {}

  // ─── Project-level (remote — team service aggregation) ────────────────────

  listProjectSummaries(): Promise<ProjectSummary[]> {
    return this.remote.listProjectSummaries();
  }
  getProjectRevision(projectSlug: string): Promise<number> {
    return this.remote.getProjectRevision(projectSlug);
  }
  getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    return this.remote.getProjectRecordCount(projectSlug);
  }

  // ─── Session records (local only) ─────────────────────────────────────────

  getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    return this.local.getRecord(projectSlug, sessionId);
  }
  listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    return this.local.listRecordsForProject(projectSlug);
  }
  listAllRecords(): Promise<SessionRecord[]> {
    return this.local.listAllRecords();
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    return this.local.upsertRecord(record);
  }

  async deleteProjectRecords(_projectSlug: string): Promise<void> {
    throw new RemoteStoreNotSupported("deleteProjectRecords");
  }

  // ─── Merge / ontology (local only) ────────────────────────────────────────

  readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    return this.local.readConceptTrieMerge();
  }
  writeConceptTrieMerge(merge: MergeRecord): Promise<void> {
    return this.local.writeConceptTrieMerge(merge);
  }
  readDeterministicMerge(): Promise<MergeRecord | undefined> {
    return this.local.readDeterministicMerge();
  }
  writeDeterministicMerge(merge: MergeRecord): Promise<void> {
    return this.local.writeDeterministicMerge(merge);
  }
  readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return this.local.readLlmRefinedMerge();
  }
  writeLlmRefinedMerge(merge: MergeRecord): Promise<void> {
    return this.local.writeLlmRefinedMerge(merge);
  }
  readLlmMergeCache(cacheKey: string): Promise<MergeRecord | undefined> {
    return this.local.readLlmMergeCache(cacheKey);
  }
  writeLlmMergeCache(cacheKey: string, merge: MergeRecord): Promise<void> {
    return this.local.writeLlmMergeCache(cacheKey, merge);
  }

  readOntologyIndex(): Promise<OntologyIndex | undefined> {
    return this.local.readOntologyIndex();
  }
  writeOntologyIndex(index: OntologyIndex): Promise<void> {
    return this.local.writeOntologyIndex(index);
  }
  readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined> {
    return this.local.readOntologyRecord(cacheKey);
  }
  writeOntologyRecord(cacheKey: string, record: OntologyRecord): Promise<void> {
    return this.local.writeOntologyRecord(cacheKey, record);
  }
  clearOntologyCache(): Promise<void> {
    return this.local.clearOntologyCache();
  }

  readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    return this.local.readLatestSegmentEquivalences(projectSlug);
  }

  // ─── Search (remote — team service) ───────────────────────────────────────

  search(
    projectSlug: string,
    query: string,
    limit: number,
    opts?: { verbose?: boolean }
  ): Promise<SearchHit[]> {
    return this.remote.search(projectSlug, query, limit, opts);
  }

  /**
   * Local revision bump for MCP index file (single-machine semantics on the
   * working copy). Team-service revision reads use `getProjectRevision`.
   */
  bumpProjectRevision(
    projectSlug: string,
    recordCount: number,
    opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    return this.local.bumpProjectRevision(projectSlug, recordCount, opts);
  }

  /** Team-service HTTP client (search, project list, push target). */
  getRemoteStore(): RemoteStore {
    return this.remote;
  }

  /** Local working copy (push queue source, UI reads). */
  getLocalStore(): Store {
    return this.local;
  }

  getPushQueue(): PushQueueLike {
    return this.queue;
  }
}

/**
 * Shape of the push queue the `TeamStore` calls. Lives in the extension
 * (`extension/src/store/pushQueue.ts`) — `shared` only defines the
 * interface so `TeamStore` can reference it without a circular import.
 */
export interface PushQueueLike {
  /** Enqueue a record — writes the pending flag but does NOT trigger a drain. */
  enqueue(record: SessionRecord): Promise<void>;
  /** Drain pending pushes. Called when the user runs the push-to-team command. */
  drain(): Promise<void>;
}
