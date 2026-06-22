import * as vscode from "vscode";
import { notifyInfo, notifyWarning } from "../notify";
import { t } from "../l10n/uiTranslate";
import { isTeamModeEnabled, getLocalSqliteStore, drainAllPushQueues } from "../store/storeClient";
import { setPendingFlagsForAllProjects } from "../store/bulkPush";

/**
 * Command: `agent-mindmap.pushToTeam`.
 *
 * Pushes all unpushed local sessions to the team service. This is the only
 * way data reaches the team service — there is no automatic push on write
 * or on activation.
 *
 * Idempotent: records already above the watermark are not re-pushed.
 */
export async function commandPushToTeam(): Promise<void> {
  // 1. Check team mode is enabled.
  if (!(await isTeamModeEnabled())) {
    notifyWarning(
      t(
        "team.push.notEnabled",
        "Team mode is not configured. Set `agentMindmap.team.serverUrl` to enable."
      )
    );
    return;
  }

  // 2. Get local store.
  const local = await getLocalSqliteStore();
  if (!local) {
    notifyWarning(
      t(
        "team.push.notEnabled",
        "Team mode is not configured. Set `agentMindmap.team.serverUrl` to enable."
      )
    );
    return;
  }

  // 3. List all local records.
  const records = await local.listAllRecords();
  if (records.length === 0) {
    notifyInfo(t("team.push.noRecords", "No local sessions to push."));
    return;
  }

  // 4. Set pending flags for all projects with records. This is idempotent —
  //    records already above the watermark will not be re-pushed.
  await setPendingFlagsForAllProjects(local, records);

  // 5. Drain all push queues inside a progress notification.
  let drainError: unknown;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t("team.push.title", "Agent Mind Map: Pushing sessions to team service…"),
      cancellable: false,
    },
    async () => {
      try {
        await drainAllPushQueues();
      } catch (err) {
        drainError = err;
      }
    }
  );

  if (drainError) {
    // Partial or full failure. The watermarks reflect what did get pushed;
    // the pending flags stay set for what didn't. Re-running the command
    // will retry from the watermark.
    notifyWarning(
      t(
        "team.push.partialFail",
        "Some sessions failed to push. Re-run the command to retry remaining sessions. Error: {0}",
        drainError instanceof Error ? drainError.message : String(drainError)
      )
    );
    return;
  }

  // 6. Success.
  notifyInfo(t("team.push.done", "Pushed {0} session(s) to team service.", String(records.length)));
}
