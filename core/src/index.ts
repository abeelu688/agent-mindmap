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
