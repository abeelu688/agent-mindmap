import type { PushQueueLike } from "@agent-mindmap/shared";
import type { RemoteStore, SessionRecord, Store } from "@agent-mindmap/shared";
import type { SqliteStore } from "@agent-mindmap/shared";

/**
 * Push queue — mirrors local session writes to the team service.
 *
 * Design:
 *   - `enqueue(record)`: bumps the per-project "highest enqueued analyzedAt"
 *     counter in local `kv` (key `push-pending:<slug>` = number). Does NOT
 *     push yet and does NOT trigger a drain — only writes the pending flag.
 *   - `drain()`: for each project with `analyzedAt > lastPushedWatermark`,
 *     list local records, push each via `RemoteStore.upsertRecord`, advance
 *     the watermark on success. Failures leave the watermark unchanged so
 *     the next drain retries. Called only when the user explicitly runs the
 *     "Push Sessions to Team Service" command.
 *
 * Watermarks in local `kv`:
 *   - `push-watermark:<slug>` = number (max analyzedAt successfully pushed)
 *   - `push-pending:<slug>` = number (max analyzedAt enqueued but not yet
 *     confirmed pushed). Used to know which projects need draining.
 *
 * No auto-retry: on drain failure, the watermark stays at the last
 * successfully-pushed value and the pending flag stays set. The user re-runs
 * the command to retry. The queue is persistent (watermarks in kv) so a
 * restart resumes from the last confirmed push.
 */

export const WATERMARK_PREFIX = "push-watermark:";
export const PENDING_PREFIX = "push-pending:";

export class PushQueue implements PushQueueLike {
  private draining = false;
  private redrainRequested = false;

  constructor(
    private readonly local: SqliteStore,
    private readonly remote: RemoteStore
  ) {}

  /**
   * Enqueue a record for future push. Writes the `push-pending:<slug>` kv
   * flag but does NOT trigger a drain. The drain happens only when the user
   * explicitly runs the "Push Sessions to Team Service" command.
   */
  async enqueue(record: SessionRecord): Promise<void> {
    const slug = record.meta.projectSlug;
    if (!slug) {
      return;
    }
    const at = record.meta.analyzedAt;
    const pendingKey = PENDING_PREFIX + slug;
    const current = (await this.local.readKvJson<number>(pendingKey)) ?? 0;
    if (at > current) {
      await this.local.writeKvJson(pendingKey, at);
    }
    // No auto-drain — the command calls drain() explicitly.
  }

  async drain(): Promise<void> {
    if (this.draining) {
      // A drain is already running. Mark that another drain was requested
      // so the in-flight drain re-runs after it finishes. Without this,
      // a pending key written during the in-flight drain would sit
      // unprocessed until the next command invocation.
      this.redrainRequested = true;
      return;
    }
    this.draining = true;
    try {
      // Loop: drain, then check if another drain was requested during the
      // in-flight one. Re-run until no more requests.
      for (;;) {
        this.redrainRequested = false;
        try {
          await this.drainOnce();
        } catch (err) {
          // Log the failure and stop — no auto-retry. The user re-runs the
          // command to retry. The watermark and pending flag reflect the
          // partial progress so the next drain picks up where this left off.
          console.warn("[agent-mindmap] push queue drain failed:", err);
          break;
        }
        if (!this.redrainRequested) {
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce(): Promise<void> {
    const pendingKeys = await this.local.listKvKeys(PENDING_PREFIX);
    if (pendingKeys.length === 0) {
      return;
    }
    for (const pendingKey of pendingKeys) {
      const slug = pendingKey.slice(PENDING_PREFIX.length);
      const pendingAt = (await this.local.readKvJson<number>(pendingKey)) ?? 0;
      const watermarkKey = WATERMARK_PREFIX + slug;
      const watermark = (await this.local.readKvJson<number>(watermarkKey)) ?? 0;
      if (pendingAt <= watermark) {
        // Already pushed — clear the pending flag.
        await this.local.deleteKv(pendingKey);
        continue;
      }
      // List local records for this project and push those with
      // analyzedAt > watermark.
      const records = await this.listLocalRecordsForProject(slug);
      const toPush = records
        .filter((r) => r.meta.analyzedAt > watermark)
        .sort((a, b) => a.meta.analyzedAt - b.meta.analyzedAt);
      let newWatermark = watermark;
      for (const rec of toPush) {
        try {
          await this.remote.upsertRecord(rec);
          newWatermark = Math.max(newWatermark, rec.meta.analyzedAt);
        } catch (err) {
          // Persist the watermark we've reached + leave pending flag set
          // so the next drain retries from here.
          if (newWatermark > watermark) {
            await this.local.writeKvJson(watermarkKey, newWatermark);
          }
          throw err;
        }
      }
      // All records pushed — advance watermark + clear pending.
      await this.local.writeKvJson(watermarkKey, newWatermark);
      await this.local.deleteKv(pendingKey);
    }
  }

  /**
   * List local records for a project. Uses the local Store interface so
   * this works against any `Store` impl (SqliteStore in production).
   */
  private async listLocalRecordsForProject(slug: string): Promise<SessionRecord[]> {
    return this.local.listRecordsForProject(slug);
  }

  /** No-op — kept for API compatibility. Retry timers were removed. */
  dispose(): void {}
}

/** Factory: build a PushQueue from a TeamStore's local + remote backends. */
export function makePushQueue(local: SqliteStore, remote: RemoteStore): PushQueue {
  return new PushQueue(local, remote);
}

/** For tests: inspect the queue's pending state. */
export const __testing = {
  WATERMARK_PREFIX,
  PENDING_PREFIX,
};
