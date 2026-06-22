/**
 * Extension adapter for extractCodeReferences — pre-binds LlmDumpDeps
 * so extension callers don't need to pass it every time.
 */
import {
  extractCodeReferencesFromEvents as coreExtractCodeReferencesFromEvents,
  generateCodeReferenceDescriptions as coreGenerateCodeReferenceDescriptions,
  type GenerateCodeReferenceDescriptionsOpts,
  type CodeRefBatchProgress,
  type FileEntry,
  type ProgressReporter,
} from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "./llmIoDumpAdapter";
import type {
  LlmProvider,
  OutputLanguage,
  ChatEvent,
  CodeReference,
  SessionOutline,
} from "@agent-mindmap/core";

/**
 * Extract codeReferences from ChatEvents — extension version with pre-bound dump deps.
 * Drop-in replacement for the old extension/src/llm/extractCodeReferences.ts.
 */
export async function extractCodeReferencesFromEvents(
  events: ChatEvent[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: {
    projectPath?: string;
    model?: string;
    timeoutMs?: number;
    cacheDir?: string;
    cache?: boolean;
    outline?: SessionOutline;
    outputLanguage?: OutputLanguage;
    onBatchComplete?: (progress: CodeRefBatchProgress) => void | Promise<void>;
  },
  progress?: ProgressReporter
): Promise<CodeReference[]> {
  return coreExtractCodeReferencesFromEvents(
    events,
    provider,
    signal,
    opts,
    progress,
    extensionLlmDumpDeps
  );
}

/**
 * Generate code reference descriptions — extension version with pre-bound dump deps.
 */
export async function generateCodeReferenceDescriptions(
  entries: FileEntry[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: GenerateCodeReferenceDescriptionsOpts,
  progress?: ProgressReporter
): Promise<CodeReference[]> {
  return coreGenerateCodeReferenceDescriptions(
    entries,
    provider,
    signal,
    opts,
    progress,
    extensionLlmDumpDeps
  );
}

// Re-export types and pure functions that don't need deps
export {
  buildMarkCode,
  extractFilePathsFromEvents,
  buildPendingCodeReferencesFromEvents,
  composeIncrementalCodeRefs,
  normalizeCodeRefDescPath,
  isFallbackCodeReferenceDescription,
  CODE_REF_DESC_PROMPT_VERSION,
  __testingExtractCodeRefs as __testing,
  type FileEntry as FileEntryType,
  type GenerateCodeReferenceDescriptionsOpts as GenCodeRefDescOpts,
  type CodeRefBatchProgress as CodeRefBatchProgressType,
} from "@agent-mindmap/core";
