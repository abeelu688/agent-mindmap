import * as vscode from "vscode";
import { resolveUiLocale } from "../l10n/uiTranslate";

/**
 * Language used inside LLM prompt templates.
 *
 * Currently only `zh` is fully implemented; `en` prompt text is being
 * filled in incrementally — see `docs/IMPROVEMENT-PLAN.md` Phase 4.2.
 * Adding more languages (ja, ko, …) should be a separate effort that
 * verifies the LLM still produces well-formed JSON — see CONTRIBUTING.md
 * → "Translating LLM prompts".
 */
export type PromptLanguage = "zh" | "en";

type PromptLanguageSetting = "auto" | PromptLanguage;

function readSetting(): PromptLanguageSetting {
  const raw = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("llm.promptLanguage", "auto");
  if (raw === "zh" || raw === "en") {
    return raw;
  }
  return "auto";
}

/**
 * Resolve the prompt language to use for LLM calls.
 *
 * 1. Honor the explicit `agentMindmap.llm.promptLanguage` setting.
 * 2. When `auto`, follow `agentMindmap.ui.locale`:
 *    - `zh-cn`  → `zh`
 *    - everything else → `zh` *for now* (will become `en` once English
 *      prompt templates are stable across all stages)
 *
 * NOTE: while English prompt templates are still being added, the auto
 * fallback returns `zh` for every locale to preserve current behavior.
 * Flip the fallback to `en` once `promptOutline` and friends have full
 * English text coverage and have been benchmarked against the eval
 * pipeline.
 */
export function resolvePromptLanguage(): PromptLanguage {
  const setting = readSetting();
  if (setting !== "auto") {
    return setting;
  }
  const uiLocale = resolveUiLocale();
  if (uiLocale === "zh-cn") {
    return "zh";
  }
  // TODO(i18n): switch to `"en"` once English prompt templates ship.
  return "zh";
}
