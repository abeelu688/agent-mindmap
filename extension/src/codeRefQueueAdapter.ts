/**
 * Extension adapter for CodeRefQueueDeps — implements the core port
 * using VS Code APIs (MindMapPanel, notifications, progress UI, store).
 */
import { MindMapPanel } from "./webview/MindMapPanel";
import { getStoreForDir } from "./store/storeClient";
import { rebuildProjectMergeFromStore } from "./mindmap/rebuildMindMapFromStore";
import {
  getLastBatchStatus,
  setLastBatchStatus,
  getPendingMindMap,
  setPendingMindMap,
} from "./batch/batchStatus";
import { notifyInfo } from "./notify";
import { withCancellableNotificationProgress } from "./progressHelpers";
import { mindMapLog } from "./webview/MindMapLog";
import { agentLog } from "./log";
import { t } from "./l10n/uiTranslate";
import type { CodeRefQueueDeps, ProgressReporter, MindMapRoot } from "@agent-mindmap/core";
import type { BatchStatus } from "./webview/MindMapHost";

export const extensionCodeRefQueueDeps: CodeRefQueueDeps = {
  logInfo(message: string) {
    mindMapLog(message);
  },

  logWarn(message: string, data?: Record<string, unknown>) {
    agentLog.warn(message, data);
  },

  logError(message: string, err?: unknown, _data?: Record<string, unknown>) {
    agentLog.error(message, err);
  },

  async withCancellableProgress<T>(
    title: string,
    initialMessage: string,
    run: (ctx: { progress: ProgressReporter; signal: AbortSignal }) => Promise<T>
  ): Promise<T | undefined> {
    return withCancellableNotificationProgress(
      title,
      initialMessage,
      async ({ progress, signal }) => {
        // MindMapProgress is structurally identical to ProgressReporter — both have
        // `report(update: string | { message?: string; increment?: number })`.
        return run({ progress: progress as unknown as ProgressReporter, signal });
      }
    );
  },

  async getStore(storeDir: string) {
    return getStoreForDir(storeDir);
  },

  async rebuildProjectMerge(
    storeDir: string,
    projectSlug: string
  ): Promise<MindMapRoot | undefined> {
    const merge = await rebuildProjectMergeFromStore(storeDir, projectSlug);
    if (!merge) {
      return undefined;
    }
    // Write the merge back to the store (matches original behavior)
    await (await getStoreForDir(storeDir)).writeConceptTrieMerge(merge);
    return merge.mindMap;
  },

  onPendingCodeRefRefresh(pendingMap: MindMapRoot, label: string): void {
    setPendingMindMap(pendingMap, undefined, label);
    const panel = MindMapPanel.getCurrent();
    if (!panel) return;
    const currentStatus = getLastBatchStatus();
    const nextStatus: BatchStatus = currentStatus
      ? { ...currentStatus, pendingUpdateLabel: label }
      : {
          total: 1,
          processed: 1,
          analyzed: 1,
          cached: 0,
          failed: 0,
          batchNo: 0,
          running: false,
          pendingUpdateLabel: label,
        };
    setLastBatchStatus(nextStatus);
    panel.setBatchStatus(nextStatus);
    notifyInfo(
      t(
        "ui.codeRefs.pendingRefresh",
        "Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update."
      )
    );
  },

  onCodeRefPanelStatusUpdate(update: {
    active: boolean;
    sessionLabel?: string;
    message?: string;
    queueRemaining?: number;
  }): void {
    const panel = MindMapPanel.getCurrent();
    if (!panel) return;
    const current = getLastBatchStatus();
    if (!current) return;
    const nextStatus: BatchStatus = update.active
      ? {
          ...current,
          codeRefActive: true,
          codeRefSessionLabel: update.sessionLabel,
          codeRefMessage: update.message,
          codeRefQueueRemaining: update.queueRemaining,
        }
      : {
          ...current,
          codeRefActive: undefined,
          codeRefSessionLabel: undefined,
          codeRefMessage: undefined,
          codeRefQueueRemaining: undefined,
        };
    setLastBatchStatus(nextStatus);
    panel.setBatchStatus(nextStatus);
  },

  getCurrentMindMap(): MindMapRoot | undefined {
    return MindMapPanel.getCurrent()?.getMindMapData();
  },

  getPendingMindMap(): MindMapRoot | undefined {
    return getPendingMindMap();
  },
};
