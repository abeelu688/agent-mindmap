/**
 * Port interface for code-reference queue operations — decouples from
 * MindMapPanel, notifyInfo, withCancellableNotificationProgress, batchStatus,
 * and extension-specific logging.
 *
 * The extension implements this with VS Code APIs (panel updates, notifications,
 * progress UI); the CLI implements it with ora spinner + console logging;
 * tests use a no-op or stub implementation.
 */
import type { ProgressReporter } from "./ProgressReporter";
import type { MindMapRoot } from "../transcript/types";
import type { Store } from "@agent-mindmap/shared";

export interface CodeRefQueueDeps {
  // -- Logging (replaces mindMapLog / agentLog) --
  /** General info log. */
  logInfo(message: string): void;
  /** Warning log. */
  logWarn(message: string, data?: Record<string, unknown>): void;
  /** Error log. */
  logError(message: string, err?: unknown, data?: Record<string, unknown>): void;

  // -- Progress & cancellation (replaces withCancellableNotificationProgress) --
  /**
   * Run a cancellable operation with progress UI.
   * Extension: vscode.window.withProgress (cancellable notification).
   * CLI: ora spinner + AbortController.
   * Returns undefined when cancelled by user.
   */
  withCancellableProgress<T>(
    title: string,
    initialMessage: string,
    run: (ctx: { progress: ProgressReporter; signal: AbortSignal }) => Promise<T>
  ): Promise<T | undefined>;

  // -- Store access (replaces getStoreForDir) --
  /** Get the Store for a given storeDir. */
  getStore(storeDir: string): Promise<Store>;

  // -- Mind map rebuild (replaces rebuildProjectMergeFromStore) --
  /** Rebuild a project merge from the store. Returns undefined if no merge exists. */
  rebuildProjectMerge(storeDir: string, projectSlug: string): Promise<MindMapRoot | undefined>;

  // -- Panel/notification events (replaces MindMapPanel + batchStatus + notifyInfo) --
  /**
   * Called when the panel should show/update a pending code-ref refresh.
   * Extension: sets pendingMindMap + BatchStatus on MindMapPanel + shows notification.
   * CLI: no-op or logs.
   */
  onPendingCodeRefRefresh?(pendingMap: MindMapRoot, label: string): void;

  /**
   * Called when code-ref panel status changes.
   * Extension: updates BatchStatus.codeRef* fields on MindMapPanel.
   * CLI: no-op.
   */
  onCodeRefPanelStatusUpdate?(update: {
    active: boolean;
    sessionLabel?: string;
    message?: string;
    queueRemaining?: number;
  }): void;

  // -- Panel state queries (replaces MindMapPanel.getCurrent().getMindMapData() + getPendingMindMap) --
  /** Get the current mind map data from the panel. */
  getCurrentMindMap?(): MindMapRoot | undefined;
  /** Get the pending mind map (from batch status). */
  getPendingMindMap?(): MindMapRoot | undefined;
}
