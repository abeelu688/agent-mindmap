import * as vscode from "vscode";
import { t } from "../l10n/uiTranslate";
import { PENDING_PREFIX } from "./pushQueue";
import type { SessionRecord, SqliteStore } from "@agent-mindmap/shared";

/**
 * Push local sessions to the team service — called by the "Push Sessions to
 * Team Service" command.
 *
 * Mechanism: we set the `push-pending:<slug>` flag (to the max `analyzedAt`
 * for that project) for every project that has local records, then invoke
 * `drainAllPushQueues()` inside a VS Code progress notification. The push
 * queue handles watermark advancement. On failure, the watermarks reflect
 * partial progress and the pending flags stay set so the next command
 * invocation retries from there.
 *
 * This is idempotent — records already above the watermark are not
 * re-pushed.
 */

export type PushLocalResult =
  | { kind: "skipped"; reason: "team-mode-off" | "no-local-store" }
  | { kind: "noop"; totalRecords: 0 }
  | { kind: "done"; totalRecords: number };

export interface PushLocalDeps {
  /** Returns true when team mode is enabled (URL + key both configured). */
  isTeamModeEnabled: () => Promise<boolean>;
  /** Returns the local SqliteStore, or undefined if not yet bootstrapped. */
  getLocalStore: () => Promise<SqliteStore | undefined>;
  /** Drains all push queues — does the actual POSTing. */
  drainAllPushQueues: () => Promise<void>;
}

export async function pushLocalRecordsToTeam(deps: PushLocalDeps): Promise<PushLocalResult> {
  if (!(await deps.isTeamModeEnabled())) {
    return { kind: "skipped", reason: "team-mode-off" };
  }
  const local = await deps.getLocalStore();
  if (!local) {
    return { kind: "skipped", reason: "no-local-store" };
  }
  const records = await local.listAllRecords();
  if (records.length === 0) {
    return { kind: "noop", totalRecords: 0 };
  }

  // Set `push-pending:<slug>` = max analyzedAt for each project that has
  // local records. The drain will push every record with analyzedAt >
  // watermark, so this effectively queues all unpushed records.
  await setPendingFlagsForAllProjects(local, records);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("team.push.title", "Agent Mind Map: Pushing sessions to team service…"),
      cancellable: false,
    },
    async () => {
      await deps.drainAllPushQueues();
    }
  );

  return { kind: "done", totalRecords: records.length };
}

export async function setPendingFlagsForAllProjects(
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
