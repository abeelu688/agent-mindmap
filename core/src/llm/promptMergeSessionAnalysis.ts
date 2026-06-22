/**
 * Prompt version constant for the merge-session-analysis LLM stage.
 *
 * The full prompt builder (`buildMergeSessionAnalysisPrompt`) remains in
 * `extension/src/llm/promptMergeSessionAnalysis.ts` because it depends on
 * `LlmProvider` and other extension-coupled services. The version constant
 * lives here so that core modules (e.g. `mergeSnapshot`, `ontologyStore`) can
 * reference it without importing from the extension.
 */
export const MERGE_SESSION_ANALYSIS_PROMPT_VERSION = 11;
