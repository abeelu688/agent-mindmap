/**
 * Prompt version constant for the reattach LLM stage.
 *
 * The full prompt builder (`buildReattachPrompt`) remains in
 * `extension/src/llm/promptReattach.ts` because it depends on `LlmProvider`.
 * The version constant lives here so that core modules can reference it without
 * importing from the extension.
 */
export const REATTACH_PROMPT_VERSION = 23;
