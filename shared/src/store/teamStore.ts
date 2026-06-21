import { RemoteStoreNotSupported } from "./remoteStore";
import type { RemoteStore } from "./remoteStore";
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
 * `TeamStore` is the team-mode `Store` — a write-through wrapper that
 * combines a local `SqliteStore` (the working copy) with a `RemoteStore`
 * (the team service HTTP client) and a `PushQueue` (async drain to the
 * team service with retry + watermark).
 *
 * Read paths delegate to `RemoteStore` (the team service is authoritative
 * for cross-machine aggregation). Write paths:
 *   - `upsertRecord` → local `SqliteStore` synchronously + enqueue push.
 *     Local write is fast (sub-millisecond); push is async so analysis
 *     never blocks on network (decision: "never block local analysis on
 *     push success").
 *   - `writeConceptTrieMerge` / `writeOntologyIndex` / etc → no-op. The
 *     Go merge worker on the team service owns these; client writes have
 *     no team-mode equivalent.
 *   - `bumpProjectRevision` → no-op. Server bumps revision inside
 *     `POST /sessions/:id`.
 *   - `deleteProjectRecords` / `clearOntologyCache` → throw
 *     `RemoteStoreNotSupported` (no delete surface in v1).
 *
 * The push queue's drain is fire-and-forget — callers don't await it.
 * The queue persists its watermark in the local `kv` table so restarts
 * resume from the last successfully-pushed `analyzedAt`.
 */
export class TeamStore implements Store {
  constructor(
    private readonly local: Store,
    private readonly remote: RemoteStore,
    private readonly queue: PushQueueLike
  ) {}

  // ─── Project-level (read → remote) ──────────────────────────────────────────

  listProjectSummaries(): Promise<ProjectSummary[]> {
    return this.remote.listProjectSummaries();
  }
  getProjectRevision(projectSlug: string): Promise<number> {
    return this.remote.getProjectRevision(projectSlug);
  }
  getProjectRecordCount(projectSlug: string): Promise<number | undefined> {
    return this.remote.getProjectRecordCount(projectSlug);
  }

  // ─── Session records (read → remote; write → local + push) ──────────────────

  getRecord(projectSlug: string, sessionId: string): Promise<SessionRecord | undefined> {
    return this.remote.getRecord(projectSlug, sessionId);
  }
  listRecordsForProject(projectSlug: string): Promise<SessionRecord[]> {
    return this.remote.listRecordsForProject(projectSlug);
  }
  listAllRecords(): Promise<SessionRecord[]> {
    return this.remote.listAllRecords();
  }

  async upsertRecord(record: SessionRecord): Promise<{ revision: number }> {
    // Local write first — keeps the working copy current and gives us a
    // revision number to return. The push to the team service is async
    // via the queue.
    const result = await this.local.upsertRecord(record);
    // Fire-and-forget enqueue; the queue's drain handles retry/backoff.
    void this.queue.enqueue(record).catch((err) => {
      // Log + swallow — push failures must not break local analysis.
      console.warn(
        `[agent-mindmap] team push queue enqueue failed for ${record.meta.projectSlug}/${record.meta.sessionId}: ${(err as Error).message}`
      );
    });
    return result;
  }

  async deleteProjectRecords(_projectSlug: string): Promise<void> {
    throw new RemoteStoreNotSupported("deleteProjectRecords");
  }

  // ─── Merge / ontology (writes no-op; reads → remote) ─────────────────────────

  readConceptTrieMerge(): Promise<MergeRecord | undefined> {
    return this.remote.readConceptTrieMerge();
  }
  async writeConceptTrieMerge(_merge: MergeRecord): Promise<void> {
    // No-op — the Go merge worker owns this on the server side.
  }
  readDeterministicMerge(): Promise<MergeRecord | undefined> {
    return this.remote.readDeterministicMerge();
  }
  async writeDeterministicMerge(_merge: MergeRecord): Promise<void> {
    // No-op.
  }
  readLlmRefinedMerge(): Promise<MergeRecord | undefined> {
    return this.remote.readLlmRefinedMerge();
  }
  async writeLlmRefinedMerge(_merge: MergeRecord): Promise<void> {
    // No-op.
  }
  readLlmMergeCache(cacheKey: string): Promise<MergeRecord | undefined> {
    return this.remote.readLlmMergeCache(cacheKey);
  }
  async writeLlmMergeCache(_cacheKey: string, _merge: MergeRecord): Promise<void> {
    // No-op.
  }

  readOntologyIndex(): Promise<OntologyIndex | undefined> {
    return this.remote.readOntologyIndex();
  }
  async writeOntologyIndex(_index: OntologyIndex): Promise<void> {
    // No-op.
  }
  readOntologyRecord(cacheKey: string): Promise<OntologyRecord | undefined> {
    return this.remote.readOntologyRecord(cacheKey);
  }
  async writeOntologyRecord(_cacheKey: string, _record: OntologyRecord): Promise<void> {
    // No-op.
  }
  async clearOntologyCache(): Promise<void> {
    // No-op — server-side concern.
  }

  readLatestSegmentEquivalences(projectSlug: string): Promise<SegmentEquivalence[]> {
    return this.remote.readLatestSegmentEquivalences(projectSlug);
  }

  /**
   * No-op in team mode — the server bumps revision inside `POST /sessions/:id`.
   * Returns a placeholder McpIndexFile so callers that read the result don't
   * crash. Real revision reads go through `getProjectRevision` (remote).
   */
  async bumpProjectRevision(
    projectSlug: string,
    _recordCount: number,
    _opts?: { lastAnalyzedAt?: number; projectPath?: string }
  ): Promise<McpIndexFile> {
    // No-op. Caller in single-machine mode uses the returned McpIndexFile to
    // refresh the MCP search index; in team mode the search index reads from
    // the team service directly, so this return value is unused.
    return {
      schemaVersion: 1,
      updatedAt: Date.now(),
      projects: {
        [projectSlug]: {
          revision: 0,
          recordCount: 0,
          lastBuiltAt: 0,
        },
      },
    };
  }

  /** Exposed for callers that need the underlying RemoteStore (e.g. search). */
  getRemoteStore(): RemoteStore {
    return this.remote;
  }

  /** Exposed for callers that need the local Store (e.g. push queue drain). */
  getLocalStore(): Store {
    return this.local;
  }

  /** Exposed for activation drain + tests. */
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
  /** Enqueue a record for async push to the team service. */
  enqueue(record: SessionRecord): Promise<void>;
  /** Drain pending pushes. Called on activation + after each enqueue. */
  drain(): Promise<void>;
}
