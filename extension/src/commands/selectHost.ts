import { selectHost } from "@agent-mindmap/core";
import { resetHostCache, getHostById, WORKSPACE_HOST_KEY } from "../host";
import { notifyInfo } from "../notify";
import { buildPrompter } from "../adapters/coreUseCaseDeps";
import type * as vscode from "vscode";

export async function commandSelectHost(context: vscode.ExtensionContext): Promise<void> {
  const hostId = await selectHost({
    prompter: buildPrompter(),
    configStore: {
      get<T>(_key: string) {
        return context.workspaceState.get<T>(WORKSPACE_HOST_KEY);
      },
      set(_key: string, value: unknown) {
        context.workspaceState.update(WORKSPACE_HOST_KEY, value);
      },
    },
  });
  if (hostId) {
    resetHostCache();
    const host = getHostById(hostId);
    notifyInfo(`Agent Mind Map: Host set to ${host.displayName} for this workspace`);
  }
}
