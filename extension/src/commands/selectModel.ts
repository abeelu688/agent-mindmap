import * as vscode from "vscode";
import { selectModel, CLI_SETTINGS_KEY } from "@agent-mindmap/core";
import { readLlmOptions } from "../llmOptions";
import { showCliInstallGuide } from "../llm/cliInstallGuideUi";
import { notifyInfo } from "../notify";
import { t } from "../l10n/uiTranslate";
import { buildPrompter, buildLogger } from "../adapters/coreUseCaseDeps";

export async function commandSelectModel(context: vscode.ExtensionContext): Promise<void> {
  const result = await selectModel({
    prompter: buildPrompter(),
    configStore: {
      get: (key) => vscode.workspace.getConfiguration("agentMindmap").get(key),
      set: (key, val) =>
        vscode.workspace
          .getConfiguration("agentMindmap")
          .update(key, val, vscode.ConfigurationTarget.Global),
    },
    logger: buildLogger(),
    cliPath: (await readLlmOptions(context)).cliPath,
    onNoCliFound: async () => {
      const claudeGuideLabel = t("ui.selectModel.noCli.claudeGuide", "Claude Code install guide");
      const cursorGuideLabel = t("ui.selectModel.noCli.cursorGuide", "Cursor Agent install guide");
      const settingsLabel = t("ui.selectModel.noCli.settings", "Set CLI path in settings…");
      const choice = await vscode.window.showWarningMessage(
        t(
          "ui.selectModel.noCli.message",
          "Agent Mind Map: No LLM CLI detected on this machine. Install Claude Code CLI or Cursor Agent CLI to enable mind map generation."
        ),
        { modal: true },
        claudeGuideLabel,
        cursorGuideLabel,
        settingsLabel
      );
      if (choice === claudeGuideLabel) {
        await showCliInstallGuide("claude-code", { modal: false });
      } else if (choice === cursorGuideLabel) {
        await showCliInstallGuide("cursor", { modal: false });
      } else if (choice === settingsLabel) {
        await vscode.commands.executeCommand("workbench.action.openSettings", CLI_SETTINGS_KEY);
      }
    },
  });
  if (result) {
    notifyInfo(
      t(
        "ui.selectModel.applied",
        "Agent Mind Map: Model set to {0}.",
        result.model || t("webview.menu.model.default", "Default")
      )
    );
  }
}
