import * as vscode from "vscode";
import { ensureModelConfigured } from "@agent-mindmap/core";
import { getActiveHost } from "./host";
import type { LlmProviderId, LlmProviderOptions } from "@agent-mindmap/core";

export function resolveLlmProviderId(setting: string, hostDefault: LlmProviderId): LlmProviderId {
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
    timeoutMs: Math.max(1000, config.get<number>("llm.timeoutMs", 300000) ?? 300000),
    maxAttempts: Math.max(1, Math.min(10, config.get<number>("llm.maxAttempts", 3) ?? 3)),
    retryBackoffMs: Math.max(
      0,
      Math.min(30000, config.get<number>("llm.retryBackoffMs", 1000) ?? 1000)
    ),
    maxTopics: Math.max(2, config.get<number>("merge.llm.maxTopics", 8) ?? 8),
    maxItemsPerTopic: Math.max(1, config.get<number>("merge.llm.maxItemsPerTopic", 6) ?? 6),
    hostId: host.id,
  };
}

/**
 * Ensure the LLM provider's CLI is actually available before proceeding.
 *
 * Probes the filesystem (not a sticky flag), so it catches cases where
 * the CLI was uninstalled or the provider changed since last use.
 */
export async function ensureModelSelected(context: vscode.ExtensionContext): Promise<boolean> {
  const host = await getActiveHost(context);
  const config = vscode.workspace.getConfiguration("agentMindmap");
  const cliPath = (config.get<string>("llm.cliPath") ?? "").trim();

  const result = await ensureModelConfigured({
    configStore: {
      get: (key) => config.get(key),
      set: () => {},
    },
    hostDefaultProvider: host.defaultLlmProvider,
    cliPath: cliPath || undefined,
  });

  if (result.ok) {
    return true;
  }

  // CLI not available — prompt user to select
  await vscode.commands.executeCommand("agent-mindmap.selectModel");

  // Re-check after selection (config may have changed)
  const afterConfig = vscode.workspace.getConfiguration("agentMindmap");
  const afterCliPath = (afterConfig.get<string>("llm.cliPath") ?? "").trim();
  const afterResult = await ensureModelConfigured({
    configStore: {
      get: (key) => afterConfig.get(key),
      set: () => {},
    },
    hostDefaultProvider: host.defaultLlmProvider,
    cliPath: afterCliPath || undefined,
  });
  return afterResult.ok;
}
