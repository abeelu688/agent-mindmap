/**
 * Extension-local re-export of `finalizeSessionAnalysis` from core.
 *
 * The core version uses English-default `outlineToTopicGraph`. The extension
 * re-exports the core function directly since the TopicGraph output is used
 * for concept-path computation, not UI display — the locale difference in
 * placeholder labels (e.g. "Agent Session" vs localized) does not affect
 * correctness.
 */
export {
  finalizeSessionAnalysis,
  analysisToConceptExtract,
  analysisToSessionSynonyms,
  type FinalizeSessionAnalysisMeta,
  type FinalizedSessionAnalysis,
} from "@agent-mindmap/core";
