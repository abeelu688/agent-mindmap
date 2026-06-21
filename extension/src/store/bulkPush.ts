import * as vscode from "vscode";
import { t } from "../l10n/uiTranslate";
import { PENDING_PREFIX } from "./pushQueue";
import type { SessionRecord, SqliteStore } from "@agent-mindmap/shared";

/**
 * One-shot bulk push (P4.4) — when team mode is first enabled, push every
 * local session to the team service so the server-side merge index starts
 * from a complete dataset. Per `TEAM_MODE.md` §Migration 2.
 *
 * Detection: a `globalState` flag (`agentMindmap.team.bulkPushDone`) marks
 * the machine as "bulk-pushed". The flag is per-machine (not per-workspace)
 * because the local SqliteStore is per-machine — once we've pushed its
 * contents once, the incremental push queue (P4.3) keeps the server in sync
 * on every subsequent `upsertRecord`.
 *
 * Mechanism: rather than reimplement the push loop, we set the
 * `push-pending:<slug>` flag (to the max `analyzedAt` for that project) for
 * every project that has local records, then invoke `drainAllPushQueues()`
 * inside a VS Code progress notification. The push queue handles retry,
 * backoff, and watermark advancement. After the drain returns, we mark the
 * flag done — even on partial failure, the queue's watermarks reflect what
 * did get pushed, and the next activation's incremental drain retries the
 * rest.
 */

export const BULK_PUSH_DONE_KEY = "agentMindmap.team.bulkPushDone";

export type BulkPushResult =
  | { kind: "skipped"; reason: "already-done" | "team-mode-off" | "no-local-store" }
  | { kind: "noop"; totalRecords: 0 }
  | { kind: "done"; totalRecords: number };

export interface BulkPushDeps {
  /** Returns true when team mode is enabled (URL + key both configured). */
  isTeamModeEnabled: () => Promise<boolean>;
  /** Returns the local SqliteStore, or undefined if not yet bootstrapped. */
  getLocalStore: () => Promise<SqliteStore | undefined>;
  /** Drains all push queues — does the actual POSTing. */
  drainAllPushQueues: () => Promise<void>;
}

export async function runBulkPushIfNeeded(
  context: vscode.ExtensionContext,
  deps: BulkPushDeps
): Promise<BulkPushResult> {
  if (context.globalState.get<boolean>(BULK_PUSH_DONE_KEY)) {
    return { kind: "skipped", reason: "already-done" };
  }
  if (!(await deps.isTeamModeEnabled())) {
    return { kind: "skipped", reason: "team-mode-off" };
  }
  const local = await deps.getLocalStore();
  if (!local) {
    return { kind: "skipped", reason: "no-local-store" };
  }
  const records = await local.listAllRecords();
  if (records.length === 0) {
    await context.globalState.update(BULK_PUSH_DONE_KEY, true);
    return { kind: "noop", totalRecords: 0 };
  }

  // Set `push-pending:<slug>` = max analyzedAt for each project that has
  // local records. The drain will push every record with analyzedAt >
  // watermark (which is 0/undefined on first run), so this effectively
  // queues all records for push.
  await setPendingFlagsForAllProjects(local, records);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("team.bulkPush.title", "Agent Mind Map: Bulk pushing sessions to team service…"),
      cancellable: false,
    },
    async () => {
      await deps.drainAllPushQueues();
    }
  );

  await context.globalState.update(BULK_PUSH_DONE_KEY, true);
  return { kind: "done", totalRecords: records.length };
}

async function setPendingFlagsForAllProjects(
  local: SqliteStore,
  records: SessionRecord[]
): Promise<void> {
  const projectMaxAt = new Map<string, number>();
  for (const rec of records) {
    const slug = rec.meta.projectSlug;
    if (!slug) continue;
    projectMaxAt.set(slug, Math.max(projectMaxAt.get(slug) ?? 0, rec.meta.analyzedAt));
  }
  for (const [slug, maxAt] of projectMaxAt) {
    const pendingKey = PENDING_PREFIX + slug;
    const current = (await local.readKvJson<number>(pendingKey)) ?? 0;
    if (maxAt > current) {
      await local.writeKvJson(pendingKey, maxAt);
    }
  }
}
