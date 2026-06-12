import * as vscode from "vscode";
import { readLlmOptions, markModelSelected } from "../llmOptions";
import {
  detectAvailableClis,
  fetchModelList,
  getCuratedModels,
  type DetectedCli,
} from "../llm/modelList";
import { showCliInstallGuide } from "../llm/cliInstallGuide";
import { CLI_SETTINGS_KEY } from "../llm/cliInstallGuide";
import { notifyInfo } from "../notify";
import { t } from "../l10n/uiTranslate";
import type { LlmProviderId } from "../llm/types";

type CliPickItem = vscode.QuickPickItem & {
  cli: DetectedCli;
  isCurrent: boolean;
};

type ModelPickItem = vscode.QuickPickItem & {
  modelId?: string;
};

export async function commandSelectModel(
  context: vscode.ExtensionContext
): Promise<void> {
  const llmOpts = await readLlmOptions(context);
  const currentProvider = llmOpts.provider;

  // ── Step 1: Detect available CLIs ──────────────────────────────────────

  const { available, missing } = await detectAvailableClis(llmOpts.cliPath);

  // No CLI found at all — show install guidance
  if (available.length === 0) {
    await showNoCliFoundDialog();
    return;
  }

  // Build QuickPick items: available + missing
  const items: CliPickItem[] = [];

  for (const cli of available) {
    const isCurrent = cli.providerId === currentProvider;
    items.push({
      label: isCurrent ? `✓ ${cli.label}` : cli.label,
      description: cli.binary,
      cli,
      isCurrent,
    });
  }

  for (const cli of missing) {
    items.push({
      label: cli.label,
      description: t(
        "ui.selectModel.cli.notFound",
        "not found"
      ),
      cli,
      isCurrent: false,
    });
  }

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t(
      "ui.selectModel.cli.placeholder",
      "Select a CLI for LLM requests"
    ),
  });

  if (!picked) {
    return;
  }

  const selectedProvider = picked.cli.providerId;

  // Update the provider setting if it changed
  if (selectedProvider !== currentProvider) {
    await vscode.workspace
      .getConfiguration("agentMindmap")
      .update("llm.provider", selectedProvider, vscode.ConfigurationTarget.Global);
  }

  // ── Step 2: Select a model for the chosen CLI ──────────────────────────

  await showModelPicker(selectedProvider, context);
}

// ─── Step 2: Model picker ─────────────────────────────────────────────────

async function showModelPicker(
  providerId: LlmProviderId,
  context: vscode.ExtensionContext
): Promise<void> {
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const currentModel = config.get<string>("llm.model", "").trim();

  // Try live fetch; fall back to curated list
  let models = await fetchModelList(providerId, "");
  if (models.length === 0) {
    models = getCuratedModels(providerId);
  }

  const CUSTOM_KEY = "__custom__";

  const providerLabel =
    providerId === "claude-cli" ? "Claude Code CLI" : "Cursor Agent CLI";

  const items: ModelPickItem[] = [
    {
      label: t("webview.menu.model.default", "Default"),
      description: currentModel === "" ? "✓ current" : "",
    },
    ...models.map((m) => ({
      label: m.label,
      description: currentModel === m.id ? "✓ current" : m.id,
      modelId: m.id,
    })),
    {
      label: t("ui.selectModel.custom.label", "Custom model name…"),
      description: "",
      modelId: CUSTOM_KEY,
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t(
      "ui.selectModel.model.placeholder",
      "Select a model for {0}",
      providerLabel
    ),
  });

  if (!picked) {
    return;
  }

  let modelValue: string;

  if (picked.modelId === CUSTOM_KEY) {
    const custom = await vscode.window.showInputBox({
      prompt: t(
        "ui.selectModel.custom.placeholder",
        "Model name (e.g. claude-sonnet-4-6)"
      ),
      value: currentModel,
    });
    if (custom === undefined) {
      return;
    }
    modelValue = custom.trim();
  } else if (picked.modelId !== undefined) {
    modelValue = picked.modelId;
  } else {
    modelValue = "";
  }

  await config.update("llm.model", modelValue, vscode.ConfigurationTarget.Global);

  await markModelSelected(context);

  const displayName = modelValue
    ? modelValue
    : t("webview.menu.model.default", "Default");
  notifyInfo(
    t(
      "ui.selectModel.applied",
      "Agent Mind Map: Model set to {0}.",
      displayName
    )
  );
}

// ─── No CLI found dialog ──────────────────────────────────────────────────

async function showNoCliFoundDialog(): Promise<void> {
  const claudeGuideLabel = t(
    "ui.selectModel.noCli.claudeGuide",
    "Claude Code install guide"
  );
  const cursorGuideLabel = t(
    "ui.selectModel.noCli.cursorGuide",
    "Cursor Agent install guide"
  );
  const settingsLabel = t(
    "ui.selectModel.noCli.settings",
    "Set CLI path in settings…"
  );

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
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      CLI_SETTINGS_KEY
    );
  }
}
