import type { PushQueueLike } from "@agent-mindmap/shared";
import type { RemoteStore, SessionRecord, Store } from "@agent-mindmap/shared";
import type { SqliteStore } from "@agent-mindmap/shared";

/**
 * Push queue (P4.3) — mirrors local session writes to the team service.
 *
 * Design:
 *   - `enqueue(record)`: bumps the per-project "highest enqueued analyzedAt"
 *     counter in local `kv` (key `push-pending:<slug>` = number). Does NOT
 *     push yet — `drain()` does the pushing.
 *   - `drain()`: for each project with `analyzedAt > lastPushedWatermark`,
 *     list local records, push each via `RemoteStore.upsertRecord`, advance
 *     the watermark on success. Failures leave the watermark unchanged so
 *     the next drain retries.
 *
 * Watermarks in local `kv`:
 *   - `push-watermark:<slug>` = number (max analyzedAt successfully pushed)
 *   - `push-pending:<slug>` = number (max analyzedAt enqueued but not yet
 *     confirmed pushed). Used to know which projects need draining.
 *
 * Backoff: on failure, `drain()` schedules a retry with exponential backoff
 * (capped at 5 min per PR plan). Successive drains dedupe via an in-flight
 * flag. The queue is persistent (watermarks in kv) so a restart resumes
 * from the last confirmed push.
 */

const WATERMARK_PREFIX = "push-watermark:";
const PENDING_PREFIX = "push-pending:";
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const MAX_RETRIES_PER_DRAIN = 3;

export class PushQueue implements PushQueueLike {
  private draining = false;
  private redrainRequested = false;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryAttempts = 0;

  constructor(
    private readonly local: SqliteStore,
    private readonly remote: RemoteStore
  ) {}

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
    // Trigger a drain (fire-and-forget). The drain dedupes via `this.draining`.
    void this.drain();
  }

  async drain(): Promise<void> {
    if (this.draining) {
      // A drain is already running. Mark that another drain was requested
      // so the in-flight drain re-runs after it finishes. Without this,
      // a pending key written during the in-flight drain would sit
      // unprocessed until the next enqueue.
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
          this.retryAttempts = 0;
          this.clearRetryTimer();
        } catch (err) {
          this.scheduleRetry(err);
          break; // Stop the loop on failure — retry timer will re-trigger.
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

  private scheduleRetry(err: unknown): void {
    this.retryAttempts += 1;
    if (this.retryAttempts > MAX_RETRIES_PER_DRAIN) {
      console.warn(
        `[agent-mindmap] push queue: gave up after ${MAX_RETRIES_PER_DRAIN} retries (will retry on next enqueue):`,
        err
      );
      this.retryAttempts = 0;
      return;
    }
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, this.retryAttempts - 1), BACKOFF_MAX_MS);
    this.clearRetryTimer();
    this.retryTimer = setTimeout(() => {
      void this.drain();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  /** Stop any pending retry timer. Called on deactivate. */
  dispose(): void {
    this.clearRetryTimer();
  }
}

/** Factory: build a PushQueue from a TeamStore's local + remote backends. */
export function makePushQueue(local: SqliteStore, remote: RemoteStore): PushQueue {
  return new PushQueue(local, remote);
}

/** For tests: inspect the queue's pending state. */
export const __testing = {
  WATERMARK_PREFIX,
  PENDING_PREFIX,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  MAX_RETRIES_PER_DRAIN,
};
