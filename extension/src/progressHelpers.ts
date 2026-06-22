import * as vscode from "vscode";
import { analyzeSession, type LoadedSession } from "@agent-mindmap/core";
import { mergeAbortSignals as coreMergeAbortSignals } from "@agent-mindmap/core";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  createProgressReporter,
  type MindMapProgress,
  type MindMapProgressUpdate,
} from "./progress";
import { t } from "./l10n/uiTranslate";
import { setActiveSession } from "./commands/openLatest";
import { buildAnalyzeSessionDeps } from "./adapters/coreUseCaseDeps";

function progressMessage(update: MindMapProgressUpdate): string {
  return typeof update === "string" ? update : (update.message ?? "");
}

export function progressTitle(): string {
  return t("ui.progress.analyzingSession.title", "Agent Mind Map: Analyzing session…");
}

export async function withNotificationProgress<T>(
  title: string,
  initialMessage: string,
  run: (progress: MindMapProgress) => Promise<T>
): Promise<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async (vscodeProgress) => {
      const progress = createProgressReporter(vscodeProgress);
      progress.report(initialMessage);
      return run(progress);
    }
  );
}

/** Merge multiple abort sources; aborts when any input signal aborts. */
export const mergeAbortSignals = coreMergeAbortSignals;

export async function withCancellableNotificationProgress<T>(
  title: string,
  initialMessage: string,
  run: (ctx: { progress: MindMapProgress; signal: AbortSignal }) => Promise<T>
): Promise<T | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (vscodeProgress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      const progress = createProgressReporter(vscodeProgress);
      progress.report(initialMessage);
      try {
        return await run({ progress, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

export async function withCancellableProgress<T>(
  run: (ctx: { signal: AbortSignal; progress: MindMapProgress }) => Promise<T>,
  title: string = progressTitle(),
  panel?: MindMapPanel,
  options?: { forwardToWebviewLoading?: boolean }
): Promise<T | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (vscodeProgress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      const panelRef = panel ?? MindMapPanel.getCurrent();
      const baseReporter = createProgressReporter(vscodeProgress);
      const forwardToWebviewLoading = options?.forwardToWebviewLoading ?? true;
      const progress: MindMapProgress = {
        report(update: MindMapProgressUpdate) {
          baseReporter.report(update);
          const message = progressMessage(update);
          if (forwardToWebviewLoading && message) {
            panelRef?.setLoading(true, message);
          }
        },
      };
      try {
        return await run({ signal: controller.signal, progress });
      } catch (err) {
        if (controller.signal.aborted) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

export function attachTranscriptWatch(
  panel: MindMapPanel,
  session: LoadedSession,
  context: vscode.ExtensionContext
): void {
  panel.watchTranscript(session.session.filePath, async () => {
    const currentPanel = MindMapPanel.getCurrent();
    currentPanel?.setLoading(
      true,
      t("ui.loading.transcriptUpdatedReanalyzing", "Transcript updated, re-analyzing…")
    );
    try {
      const handle = await withCancellableProgress(
        async ({ signal, progress }) => {
          const deps = buildAnalyzeSessionDeps(context, currentPanel!, signal, progress);
          return analyzeSession(session.session, deps, { forceRefresh: true });
        },
        progressTitle(),
        currentPanel
      );
      if (handle) {
        setActiveSession(handle.result);
        MindMapPanel.getCurrent()?.setMindMapData(handle.result.mindMap);
      }
    } finally {
      MindMapPanel.getCurrent()?.setLoading(false);
    }
  });
}
