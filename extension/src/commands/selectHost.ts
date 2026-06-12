import * as vscode from "vscode";
import { resetHostCache, getHostById, WORKSPACE_HOST_KEY } from "../host";
import { notifyInfo } from "../notify";

export async function commandSelectHost(
  context: vscode.ExtensionContext
): Promise<void> {
  const items = [
    {
      label: "Cursor",
      description: "Read Cursor agent transcripts",
      id: "cursor" as const,
    },
    {
      label: "Claude Code",
      description: "Read Claude Code transcripts",
      id: "claude-code" as const,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select agent host for current workspace",
  });
  if (!picked) {
    return;
  }
  await context.workspaceState.update(WORKSPACE_HOST_KEY, picked.id);
  resetHostCache();
  const host = getHostById(picked.id);
  notifyInfo(
    `Agent Mind Map: Host set to ${host.displayName} for this workspace`
  );
}
