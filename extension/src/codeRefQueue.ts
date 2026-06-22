/**
 * Re-export code-ref queue from @agent-mindmap/core.
 *
 * The core module requires CodeRefQueueDeps (initialized via initCodeRefQueue);
 * the extension adapter (extensionCodeRefQueueDeps) provides the VS Code-specific
 * implementation. See codeRefQueueAdapter.ts.
 */
export {
  initCodeRefQueue,
  enqueueCodeRefUpdate,
  drainCodeRefQueue,
  purgeCodeRefQueueForProject,
  flushPendingCodeRefRefreshForProject,
  getProjectSessionIdsOnMap,
  resolveCodeRefPanelNotifyKind,
  CODE_REF_MAX_ATTEMPTS,
  __testingCodeRefQueue as __testing,
  type CodeRefQueueItem,
  type CodeRefPanelNotifyKind,
} from "@agent-mindmap/core";
