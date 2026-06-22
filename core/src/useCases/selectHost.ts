/**
 * `selectHost` use case — pick between Cursor and Claude Code hosts.
 *
 * The use case builds the option list and delegates selection to the Prompter.
 * The chosen host id is persisted via ConfigStore.
 */
import type { Prompter, QuickPickItem } from "../ports/Prompter";
import type { ConfigStore } from "../ports/ConfigStore";
import type { AgentHostId } from "../host/types";

export type SelectHostDeps = {
  prompter: Prompter;
  configStore: ConfigStore;
};

type HostPickItem = QuickPickItem & { hostId: AgentHostId };

const HOST_OPTIONS: HostPickItem[] = [
  { label: "Cursor", description: "Cursor agent transcripts", hostId: "cursor" },
  { label: "Claude Code", description: "Claude Code CLI transcripts", hostId: "claude-code" },
];

/**
 * Show a host selector. Returns the selected host id, or `undefined` if cancelled.
 */
export async function selectHost(deps: SelectHostDeps): Promise<AgentHostId | undefined> {
  const picked = await deps.prompter.showQuickPick(HOST_OPTIONS, {
    placeHolder: "Select agent host",
    title: "Agent Mind Map: Select Host",
  });

  if (!picked || Array.isArray(picked)) {
    return undefined;
  }

  const hostId = (picked as HostPickItem).hostId;
  await deps.configStore.set("host", hostId);
  return hostId;
}
