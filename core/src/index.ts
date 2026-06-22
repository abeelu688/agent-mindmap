/**
 * @agent-mindmap/core — VS Code-free business logic shared between the
 * extension and the upcoming CLI.
 *
 * Subsequent phase-1 PRs continue moving modules out of `extension/src/`
 * into `core/src/`; see `docs/CLI.md` and `plans/cli-master.md` in the
 * orchestration hub.
 */

export const CORE_PACKAGE_VERSION = "0.2.3";

// Logging — pluggable backend, defaults to console.
export { setCoreLogger, getCoreLogger, type CoreLogger } from "./logging";

// Crypto (P1.4 leaf).
export { sha256Hex } from "./crypto";

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
  listSessions,
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

// Pipeline (P1.6) — leaf files only; hub pipeline files stay in extension.
export {
  PIPELINE_VERSION,
  currentPipelineVersions,
  pipelineVersionsMatch,
} from "./pipeline/pipelineVersions";
export { MERGE_APPLY_SEGMENT_EQUIVALENCES, MERGE_DERIVE_SEGMENT_EQUIVALENCES } from "./pipeline/mergeSynonymPolicy";
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
export {
  buildSessionTree,
  type BuildSessionTreeMeta,
} from "./pipeline/stages/buildSessionTree";

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
export type { ConceptOntologyRecord, ConceptNode, ConceptMapping, TopicConceptPathDecision } from "./store/ontologyTypes";