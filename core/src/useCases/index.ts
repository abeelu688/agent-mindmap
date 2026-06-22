/**
 * Use case orchestrators — thin, VS Code-free orchestration layer.
 *
 * Each use case takes a deps object (ports + dep functions) and performs
 * business logic. The extension and CLI provide different implementations
 * of the ports.
 */
export type { AnalysisHandle } from "./types";
export type {
  LoadedSession,
  LoadSessionOptions,
  AnalyzeProjectResult,
  AnalyzeProjectBatchInfo,
  AnalyzeProjectOptions,
} from "./types";

export { listSessions, type ListSessionsDeps, type ListSessionsResult } from "./listSessions";
export { selectHost, type SelectHostDeps } from "./selectHost";
export { selectModel, type SelectModelDeps, type SelectModelResult } from "./selectModel";
export {
  syncAiContext,
  type SyncAiContextDeps,
  type SyncAiContextResult,
  type McpRefresher,
} from "./syncAiContext";
export {
  installMcp,
  type InstallMcpDeps,
  type McpInstaller,
  type UseCaseMcpInstallResult,
} from "./installMcp";
export { exportSession, type ExportSessionDeps } from "./exportSession";
export { exportMergedProject, type ExportMergedProjectDeps } from "./exportMergedProject";
export { pushToTeam, type PushToTeamDeps, type TeamPushAccess } from "./pushToTeam";

// analyzeSession — foundational use case with completed() pattern
export {
  analyzeSession,
  readSettingsFromConfig,
  type AnalyzeSessionDeps,
  type Settings,
  type RunSessionPipelineFn,
  type SessionPipelineResult,
  type RunBackgroundMergeFn,
  type SanitizeSessionRecordFn,
} from "./analyzeSession";

// analyzeProject — batch analysis use case with completed() pattern
export {
  analyzeProject,
  type AnalyzeProjectDeps,
  type RunBatchMergeFn,
  type RunFinalRootRefreshFn,
  type ClearProjectCacheFn,
  type ResolveProjectRecordsFn,
  type ReadSnapshotManifestFn,
  type RefreshMcpIndexFn,
} from "./analyzeProject";
