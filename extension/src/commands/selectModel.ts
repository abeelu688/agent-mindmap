import * as vscode from "vscode";
import { readLlmOptions, markModelSelected } from "../llmOptions";
import { fetchModelList } from "../llm/modelList";
import { notifyInfo } from "../notify";
import { t } from "../l10n/uiTranslate";

export async function commandSelectModel(
  context: vscode.ExtensionContext
): Promise<void> {
  const llmOpts = await readLlmOptions(context);
  const models = await fetchModelList(llmOpts.provider, llmOpts.cliPath);
  const currentModel = llmOpts.model;
  const CUSTOM_KEY = "__custom__";

  const items: vscode.QuickPickItem[] = [
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
      label: t(
        "ui.selectModel.custom.label",
        "Custom model name…"
      ),
      description: "",
      modelId: CUSTOM_KEY,
    } as vscode.QuickPickItem & { modelId: string },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: t(
      "ui.selectModel.placeholder",
      "Select a model for LLM requests"
    ),
  });
  if (!picked) {
    return;
  }

  const pickedItem = picked as vscode.QuickPickItem & {
    modelId?: string;
  };
  let modelValue: string;

  if (pickedItem.modelId === CUSTOM_KEY) {
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
  } else if (pickedItem.modelId !== undefined) {
    modelValue = pickedItem.modelId;
  } else {
    modelValue = "";
  }

  await vscode.workspace
    .getConfiguration("agentMindmap")
    .update("llm.model", modelValue, vscode.ConfigurationTarget.Global);

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
