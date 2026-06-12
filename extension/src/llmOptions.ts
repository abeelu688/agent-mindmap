import * as vscode from "vscode";
import { getActiveHost } from "./host";
import type { LlmProviderId, LlmProviderOptions } from "./llm/types";

export function resolveLlmProviderId(
  setting: string,
  hostDefault: LlmProviderId
): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

export async function readLlmOptions(
  context: vscode.ExtensionContext
): Promise<LlmProviderOptions> {
  const host = await getActiveHost(context);
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const providerSetting = config.get<string>("llm.provider", "auto");
  return {
    provider: resolveLlmProviderId(providerSetting, host.defaultLlmProvider),
    cliPath: config.get<string>("llm.cliPath", "").trim(),
    model: config.get<string>("llm.model", "").trim(),
    timeoutMs: Math.max(
      1000,
      config.get<number>("llm.timeoutMs", 300000) ?? 300000
    ),
    maxAttempts: Math.max(
      1,
      Math.min(10, config.get<number>("llm.maxAttempts", 3) ?? 3)
    ),
    retryBackoffMs: Math.max(
      0,
      Math.min(30000, config.get<number>("llm.retryBackoffMs", 1000) ?? 1000)
    ),
    maxTopics: Math.max(2, config.get<number>("merge.llm.maxTopics", 8) ?? 8),
    maxItemsPerTopic: Math.max(
      1,
      config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6
    ),
    hostId: host.id,
  };
}

const MODEL_SELECTED_KEY = "agentMindmap.modelSelected";

export async function ensureModelSelected(
  context: vscode.ExtensionContext
): Promise<boolean> {
  const selected = context.globalState.get<boolean>(MODEL_SELECTED_KEY);
  if (selected) {
    return true;
  }
  await vscode.commands.executeCommand("agent-mindmap.selectModel");
  const nowSelected = context.globalState.get<boolean>(MODEL_SELECTED_KEY);
  return !!nowSelected;
}

export async function markModelSelected(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(MODEL_SELECTED_KEY, true);
}
