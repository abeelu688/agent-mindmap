/**
 * Re-export code reference extraction from the adapter (which pre-binds LlmDumpDeps).
 *
 * The core module now handles the extraction logic; the adapter injects
 * extensionLlmDumpDeps automatically for LLM dump operations.
 */
export {
  extractCodeReferencesFromEvents,
  generateCodeReferenceDescriptions,
  buildMarkCode,
  extractFilePathsFromEvents,
  buildPendingCodeReferencesFromEvents,
  composeIncrementalCodeRefs,
  normalizeCodeRefDescPath,
  isFallbackCodeReferenceDescription,
  CODE_REF_DESC_PROMPT_VERSION,
  __testing,
  type FileEntryType as FileEntry,
  type GenCodeRefDescOpts as GenerateCodeReferenceDescriptionsOpts,
  type CodeRefBatchProgressType as CodeRefBatchProgress,
} from "./extractCodeReferencesAdapter";
