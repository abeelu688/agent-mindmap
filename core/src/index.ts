/**
 * @agent-mindmap/core — VS Code-free business logic shared between the
 * extension and the upcoming CLI.
 *
 * Subsequent phase-1 PRs continue moving modules out of `extension/src/`
 * into `core/src/`; see `docs/CLI.md` and `plans/cli-master.md` in the
 * orchestration hub.
 */

export const CORE_PACKAGE_VERSION = "0.2.3";

// Error types (P1.10):
export {
  AgentMindmapError,
  isRetryableError,
  isCancellationError,
  isUserFacingError,
  toMindmapError,
  type MindmapErrorCode,
} from "./errors";

// Logging — pluggable backend, defaults to console.
export { setCoreLogger, getCoreLogger, type CoreLogger } from "./logging";

// Crypto (P1.4 leaf).
export { sha256Hex } from "./crypto";

// Port interfaces — seams where core delegates to the surface layer.
export * from "./ports";

// Transcript module (moved in P1.2):
export type {
  BuildOptions,
  ChatEvent,
  MindMapNodeData,
  MindMapRoot,
  NodeOrigin,
  NodeOriginRef,
  TranscriptSession,
} from "./transcript/types";
export { extractUserQuery, parseJsonl } from "./transcript/parseJsonl";
export { parseClaudeJsonl } from "./transcript/parseClaudeJsonl";
export {
  listCursorSessions,
  listFlatJsonlSessions,
  readFirstUserQueryPreview,
  readSessionFile,
  type ListSessionsContext,
} from "./transcript/listSessions";
export {
  clearStateDbBackend,
  closeStateDb,
  getStateDbValue,
  queryStateDb,
} from "./transcript/cursorStateDb";
export {
  clearComposerTitleCache,
  findKeysReferencingComposer,
  getCursorStateDbPath,
  inspectComposerHeader,
  listAgentRelatedKeys,
  loadAgentProjects,
  loadComposerHeaders,
  loadComposerTitles,
  loadGlassResumableIds,
  readStateDbKey,
  setCursorStateDbOverride,
  type AgentProject,
  type ComposerHeaderMeta,
} from "./transcript/composerTitles";

// Host module (moved in P1.3):
export type { AgentHost, AgentHostId, HostSetting } from "./host/types";
export { encodeClaudeProjectPath, decodeClaudeProjectPath } from "./host/claudePath";
export { createCursorHost } from "./host/cursorHost";
export { createClaudeHost } from "./host/claudeHost";

// LLM module (P1.4) — re-exported via a dedicated barrel under `core/src/llm/`.
export * from "./llm/barrel";

// Mindmap builders (P1.5):
export { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
export { buildMergedOutlineMindMap } from "./mindmap/buildMergedOutlineMindMap";
export { buildTopicMindMap } from "./mindmap/buildTopicMindMap";
export { buildTurnMindMap, buildMindMapData } from "./mindmap/buildMindMapData";
export {
  dedupRefs,
  leafRefs,
  unionChildRefs,
  withOrigin,
  nodeOrigin,
  type SessionMeta,
} from "./mindmap/origin";
export {
  mindMapLabelsForOutputLanguage,
  type MindMapLanguageLabels,
} from "./mindmap/outputLanguageLabels";

// Pipeline (P1.6) — leaf files + hub stages.
export {
  PIPELINE_VERSION,
  currentPipelineVersions,
  pipelineVersionsMatch,
} from "./pipeline/pipelineVersions";
export {
  createPipelineTimingCollector,
  logPipelineStageTiming,
  formatDurationMs,
  type PipelineKind,
  type PipelineTimingEntry,
  type PipelineTimingCollector,
  __testing as __testingPipelineTiming,
} from "./pipeline/pipelineTiming";
export type { StageTimingOpts } from "./pipeline/stageTimingOpts";
export {
  SNAPSHOT_ASSIGNMENT_VERSION,
  leafSnapshotIdFromSlot,
  batchNoFromLeafId,
  sortSessionsForMerge,
  sortTranscriptSessionsForMerge,
  orderingKeysFromTranscriptSessions,
  orderingKeysFromRecords,
  computeLeafSlots,
  getLeafMembersById,
  leavesAffectedByFreshSessions,
  manifestNeedsAssignmentRebuild,
  validateManifestAssignments,
  leafAssignmentForSession,
  type SessionOrderingKey,
  type LeafSlotAssignment,
  type AffectedLeaf,
  __testing as __testingSnapshotAssignment,
} from "./pipeline/snapshotAssignment";
export {
  MERGE_APPLY_SEGMENT_EQUIVALENCES,
  MERGE_DERIVE_SEGMENT_EQUIVALENCES,
} from "./pipeline/mergeSynonymPolicy";
export {
  computeStableBatchPartition,
  getLeafBatchesFromPlan,
  computeBatchGroups,
  type PartitionPlan,
  type StablePartitionOpts,
  type StableLeaf,
  type RebuildLeaf,
  type NewLeaf,
  type LeafAction,
  type LeafBatchInfo,
} from "./pipeline/stableBatchPartition";
export { buildSessionTree, type BuildSessionTreeMeta } from "./pipeline/stages/buildSessionTree";
export {
  finalizeSessionAnalysis,
  analysisToConceptExtract,
  analysisToSessionSynonyms,
  type FinalizeSessionAnalysisMeta,
  type FinalizedSessionAnalysis,
} from "./pipeline/stages/finalizeSessionAnalysis";
export { collectMergeTerms, type CollectedMergeTerms } from "./pipeline/stages/collectMergeTerms";
export {
  extractConcepts,
  type ExtractConceptsOpts,
} from "./pipeline/stages/extractConcepts";
export {
  organizeByTree,
  type OrganizeByTreeOpts,
} from "./pipeline/stages/organizeByTree";
export {
  refineSessionSynonyms,
  type RefineSessionSynonymsOpts,
} from "./pipeline/stages/refineSessionSynonyms";
export {
  mergeSessionAnalysis,
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
  type MergeSessionAnalysisOpts,
} from "./pipeline/stages/mergeSessionAnalysis";
export {
  analyzeSession as analyzeSessionStage,
  type AnalyzeSessionOpts,
  type AnalyzeSessionResult,
} from "./pipeline/stages/analyzeSession";
export {
  runSessionPipeline,
  type SessionPipelinePromptOpts,
  type SessionPipelineOpts,
  type SessionPipelineResult,
} from "./pipeline/sessionPipeline";
export {
  runMergePipeline,
  computeBatchMergeCacheKey,
  mindMapTopLevelCount,
  type MergePipelineOpts,
  type MergePipelineResult,
  type MergeRefineMode,
} from "./pipeline/mergePipeline";
export {
  updateConceptTrie,
  updateConceptTrieAsync,
  prepareRecordsBeforeReattach,
  type UpdateConceptTrieOpts,
  type ConceptMergePrepOntology,
} from "./pipeline/stages/updateConceptTrie";

// Store (P1.7) — leaf files + hub modules.
export * from "./store/atomicWrite";
export * from "./store/sessionStore";
export * from "./store/applyOntology";
export * from "./store/mergeTrieByEquivalences";
export * from "./store/pushQueue";
export * from "./store/mergeDeterministic";
export * from "./store/mergeConceptTrie";
export * from "./store/prepareConceptMergeRecords";
export * from "./store/sanitizeRecords";
export * from "./store/mergeSnapshot";
export { clearProjectAnalysisCache } from "./store/clearProjectAnalysisCache";
export {
  computeOntologyCacheKey,
  findReusableOntologyBase,
  isCompleteOntologyRecord,
  readOntologyIndex,
  readOntologyRecord,
  writeOntologyRecord,
  clearOntologyCache,
  ensureOntologyMemory,
  type OntologyIndex,
  type EnsureOntologyMemoryFlags,
} from "./store/ontologyStore";

// UI types (P1.8):
export * from "./ui/mindMapUiTypes";
export * from "./ui/themeMerge";
export * from "./ui/themePath";

// Export / offline package (P1.8):
export * from "./jumpToOriginCore";
export * from "./export/collectOriginRefs";
export * from "./export/renderTranscriptMarkdown";
export * from "./export/renderTranscriptHtml";
export * from "./export/renderTranscriptMarkdownHtml";
export {
  exportMindMapPackage,
  buildTranscriptJumpHref,
  type ExportPackageOptions,
  type ExportPackageResult,
  type ExportHostResolver,
} from "./export/exportPackage";

// MCP config core (P1.9):
export * from "./mcp/mcpConfigCore";

// Code-ref queue (P1.10):
export {
  initCodeRefQueue,
  enqueueCodeRefUpdate,
  drainCodeRefQueue,
  getCodeRefQueueDepth,
  purgeCodeRefQueueForProject,
  flushPendingCodeRefRefreshForProject,
  getProjectSessionIdsOnMap,
  resolveCodeRefPanelNotifyKind,
  CODE_REF_MAX_ATTEMPTS,
  __testingCodeRefQueue,
  type CodeRefQueueItem,
  type CodeRefPanelNotifyKind,
} from "./codeRefQueue";

// Store types only (leaf — full store extraction lands later when llm hub
// files are no longer in extension):
export type {
  MergeRecordMeta,
  MergeSnapshot,
  MergeSnapshotMeta,
  SessionIndex,
  SessionIndexEntry,
  SnapshotManifest,
  SnapshotNode,
} from "./store/storeTypes";
export type {
  ConceptOntologyRecord,
  ConceptNode,
  ConceptMapping,
  TopicConceptPathDecision,
} from "./store/ontologyTypes";

// Use case orchestrators (P1.11):
export * from "./useCases/index";
