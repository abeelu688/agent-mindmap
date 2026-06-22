import * as vscode from "vscode";
import {
  buildCliInstallGuide,
  type TranslateFn,
} from "@agent-mindmap/core";
import { uiTranslate } from "../l10n/uiTranslate";
import type { AgentHostId } from "@agent-mindmap/core";

export async function showCliInstallGuide(
  hostId: AgentHostId,
  options: { modal?: boolean; t?: TranslateFn } = {}
): Promise<void> {
  const t = options.t ?? uiTranslate;
  const guide = buildCliInstallGuide(hostId, process.platform, t);
  const modal = options.modal ?? true;

  const openSettingsLabel = t("ui.cliInstall.action.openSettings", "Open CLI settings");
  const copyLabel = t("ui.cliInstall.action.copyCommand", "Copy install command");
  const docsLabel = t("ui.cliInstall.action.openDocs", "Open install docs");

  const actions: string[] = [openSettingsLabel, docsLabel];
  if (guide.installCommand) {
    actions.splice(1, 0, copyLabel);
  }

  const choice = await vscode.window.showWarningMessage(
    guide.summary,
    { modal, detail: guide.detail },
    ...actions
  );

  if (choice === openSettingsLabel) {
    await vscode.commands.executeCommand("workbench.action.openSettings", guide.settingsKey);
    return;
  }
  if (choice === copyLabel && guide.installCommand) {
    await vscode.env.clipboard.writeText(guide.installCommand);
    void vscode.window.showInformationMessage(
      t("ui.cliInstall.copied", "Agent Mind Map: Install command copied to clipboard.")
    );
    return;
  }
  if (choice === docsLabel) {
    await vscode.env.openExternal(vscode.Uri.parse(guide.docsUrl));
  }
}