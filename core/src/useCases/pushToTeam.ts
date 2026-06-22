/**
 * `pushToTeam` use case — push local sessions to the team service.
 *
 * Idempotent: records already above the watermark are not re-pushed.
 * The actual store and HTTP operations are delegated through the TeamPushAccess port.
 */
import type { Logger } from "../ports/Logger";
import type { Prompter } from "../ports/Prompter";
import type { Store } from "@agent-mindmap/shared";
import type { SessionRecord } from "../store/storeTypes";

export type TeamPushAccess = {
  /** Check if team mode is enabled (server URL + API key configured). */
  isTeamModeEnabled(): Promise<boolean>;
  /** Check if a server URL is configured (but API key may be missing). */
  hasServerUrl(): boolean;
  /** Get the local SQLite store for team mode. Returns undefined if not configured. */
  getLocalStore(): Promise<Store | undefined>;
  /** Set pending push flags for all projects with records. */
  setPendingFlagsForAllProjects(store: Store, records: SessionRecord[]): Promise<void>;
  /** Drain all push queues (sends pending records to the team service). */
  drainAllPushQueues(): Promise<void>;
};

export type PushToTeamDeps = {
  teamPushAccess: TeamPushAccess;
  prompter: Prompter;
  logger: Logger;
};

/**
 * Push all unpushed local sessions to the team service.
 *
 * This is the only way data reaches the team service — there is no automatic
 * push on write or on activation. Idempotent: records already above the
 * watermark are not re-pushed.
 */
export async function pushToTeam(deps: PushToTeamDeps): Promise<void> {
  // 1. Check team mode is enabled.
  if (!(await deps.teamPushAccess.isTeamModeEnabled())) {
    const hasServerUrl = deps.teamPushAccess.hasServerUrl();
    if (hasServerUrl) {
      deps.prompter.showWarningMessage(
        "Team service URL is set but the API key is missing. " +
          "Run 'Agent Mind Map: Configure Team Service' to store the key."
      );
    } else {
      deps.prompter.showWarningMessage(
        "Team mode is not configured. Set `agentMindmap.team.serverUrl` to enable."
      );
    }
    return;
  }

  // 2. Get local store.
  const local = await deps.teamPushAccess.getLocalStore();
  if (!local) {
    deps.prompter.showWarningMessage(
      "Team mode is not configured. Set `agentMindmap.team.serverUrl` to enable."
    );
    return;
  }

  // 3. List all local records.
  const records = await local.listAllRecords();
  if (records.length === 0) {
    deps.prompter.showInformationMessage("No local sessions to push.");
    return;
  }

  // 4. Set pending flags for all projects with records.
  await deps.teamPushAccess.setPendingFlagsForAllProjects(local, records);

  // 5. Drain all push queues.
  let drainError: unknown;
  try {
    await deps.teamPushAccess.drainAllPushQueues();
  } catch (err) {
    drainError = err;
  }

  if (drainError) {
    deps.prompter.showWarningMessage(
      "Some sessions failed to push. Re-run the command to retry remaining sessions. " +
        `Error: ${drainError instanceof Error ? drainError.message : String(drainError)}`
    );
    return;
  }

  // 6. Success.
  deps.prompter.showInformationMessage(`Pushed ${records.length} session(s) to team service.`);
}
