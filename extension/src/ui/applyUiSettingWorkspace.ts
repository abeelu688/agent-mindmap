import * as vscode from "vscode";
import {
  parseUiSettingUpdate,
  type ApplyUiSettingResult,
} from "./applyUiSetting";

export async function applyUiSettingToWorkspace(
  key: string,
  value: string
): Promise<ApplyUiSettingResult> {
  const parsed = parseUiSettingUpdate(key, value);
  if (!parsed) {
    return { ok: false, reason: "invalid" };
  }
  if (!vscode.workspace.workspaceFolders?.length) {
    return { ok: false, reason: "no_workspace" };
  }
  await vscode.workspace
    .getConfiguration("agentMindmap")
    .update(parsed.configKey, parsed.value, vscode.ConfigurationTarget.Workspace);
  return { ok: true };
}
