/**
 * `selectModel` use case — detect LLM CLIs and select a provider + model.
 *
 * Delegates CLI detection to core's `detectAvailableClis` / `fetchModelList`.
 * User interaction (CLI picker, model picker) goes through the Prompter port.
 * Persistence goes through ConfigStore.
 */
import {
  detectAvailableClis,
  fetchModelList,
  getCuratedModels,
  type DetectedCli,
  type LlmProviderId,
} from "../index";
import type { Prompter, QuickPickItem } from "../ports/Prompter";
import type { ConfigStore } from "../ports/ConfigStore";
import type { Logger } from "../ports/Logger";

// ── ensureModelConfigured ──────────────────────────────────────────────────

/**
 * Resolve the effective LLM provider from config (handles "auto" → host default).
 */
function resolveLlmProviderId(setting: string, hostDefault: LlmProviderId): LlmProviderId {
  if (setting === "auto") {
    return hostDefault;
  }
  if (setting === "cursor-cli" || setting === "claude-cli") {
    return setting;
  }
  return hostDefault;
}

export type EnsureModelConfiguredResult =
  | { ok: true; provider: LlmProviderId }
  | {
      ok: false;
      reason: "not-configured" | "cli-missing";
      available: DetectedCli[];
      missing: DetectedCli[];
    };

/**
 * Check whether the user has explicitly configured an LLM provider and its CLI
 * is actually available on this machine.
 *
 * Returns `ok: false` when:
 *  - `reason: "not-configured"` — provider is still "auto" (user never chose)
 *  - `reason: "cli-missing"`   — provider was chosen but its binary is gone
 *
 * Unlike a sticky boolean flag, this probes the filesystem every time,
 * so it catches cases where the CLI was uninstalled or the provider changed.
 */
export async function ensureModelConfigured(deps: {
  configStore: ConfigStore;
  hostDefaultProvider: LlmProviderId;
  cliPath?: string;
}): Promise<EnsureModelConfiguredResult> {
  const providerSetting = deps.configStore.get<string>("llm.provider") ?? "auto";

  // If provider is still "auto" the user has never explicitly chosen one.
  if (providerSetting === "auto") {
    const { available, missing } = await detectAvailableClis(deps.cliPath ?? "");
    return { ok: false, reason: "not-configured", available, missing };
  }

  const resolved = resolveLlmProviderId(providerSetting, deps.hostDefaultProvider);
  const { available, missing } = await detectAvailableClis(deps.cliPath ?? "");
  const hasCli = available.some((c) => c.providerId === resolved);
  if (hasCli) {
    return { ok: true, provider: resolved };
  }
  return { ok: false, reason: "cli-missing", available, missing };
}

// ── selectModel ────────────────────────────────────────────────────────────

export type SelectModelDeps = {
  prompter: Prompter;
  configStore: ConfigStore;
  logger: Logger;
  /** Optional CLI path override (from settings). */
  cliPath?: string;
  /** Callback when no CLI is found — extension shows install guide, CLI shows error. */
  onNoCliFound?: (missing: DetectedCli[]) => Promise<void>;
};

export type SelectModelResult = {
  provider: LlmProviderId;
  model: string;
};

type CliPickItem = QuickPickItem & { cli: DetectedCli; isCurrent: boolean };
type ModelPickItem = QuickPickItem & { modelId?: string };

/**
 * Detect available LLM CLIs and let the user select a provider + model.
 *
 * Returns `undefined` when cancelled or no CLI is found.
 */
export async function selectModel(deps: SelectModelDeps): Promise<SelectModelResult | undefined> {
  const currentProvider = (deps.configStore.get<string>("llm.provider") ?? "auto") as LlmProviderId;

  // ── Step 1: Detect available CLIs ──────────────────────────────────────
  const { available, missing } = await detectAvailableClis(deps.cliPath ?? "");

  // No CLI found at all
  if (available.length === 0) {
    if (deps.onNoCliFound) {
      await deps.onNoCliFound(missing);
    } else {
      deps.logger.warn("No LLM CLI detected. Install Claude Code CLI or Cursor Agent CLI.");
    }
    return undefined;
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
      description: "not found",
      cli,
      isCurrent: false,
    });
  }

  const picked = await deps.prompter.showQuickPick(items, {
    placeHolder: "Select a CLI for LLM requests",
  });

  if (!picked || Array.isArray(picked)) {
    return undefined;
  }

  const selectedProvider = (picked as CliPickItem).cli.providerId;

  // Update the provider setting if it changed
  if (selectedProvider !== currentProvider) {
    await deps.configStore.set("llm.provider", selectedProvider);
  }

  // ── Step 2: Select a model for the chosen CLI ──────────────────────────
  const modelResult = await pickModel(selectedProvider, deps);
  return modelResult;
}

async function pickModel(
  providerId: LlmProviderId,
  deps: SelectModelDeps
): Promise<SelectModelResult | undefined> {
  const currentModel = (deps.configStore.get<string>("llm.model") ?? "").trim();

  // Try live fetch; fall back to curated list
  let models = await fetchModelList(providerId, "");
  if (models.length === 0) {
    models = getCuratedModels(providerId);
  }

  const CUSTOM_KEY = "__custom__";

  const items: ModelPickItem[] = [
    {
      label: "Default",
      description: currentModel === "" ? "✓ current" : "",
    },
    ...models.map((m) => ({
      label: m.label,
      description: currentModel === m.id ? "✓ current" : m.id,
      modelId: m.id,
    })),
    {
      label: "Custom model name…",
      description: "",
      modelId: CUSTOM_KEY,
    },
  ];

  const picked = await deps.prompter.showQuickPick(items, {
    placeHolder: `Select a model for ${providerId === "claude-cli" ? "Claude Code CLI" : "Cursor Agent CLI"}`,
  });

  if (!picked || Array.isArray(picked)) {
    return undefined;
  }

  let modelValue: string;

  if ((picked as ModelPickItem).modelId === CUSTOM_KEY) {
    const custom = await deps.prompter.showInputBox({
      prompt: "Model name (e.g. claude-sonnet-4-6)",
      value: currentModel,
    });
    if (custom === undefined) {
      return undefined;
    }
    modelValue = custom.trim();
  } else if ((picked as ModelPickItem).modelId !== undefined) {
    modelValue = (picked as ModelPickItem).modelId!;
  } else {
    modelValue = "";
  }

  await deps.configStore.set("llm.model", modelValue);

  return { provider: providerId, model: modelValue };
}
