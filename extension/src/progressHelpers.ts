import * as vscode from "vscode";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  createProgressReporter,
  type MindMapProgress,
  type MindMapProgressUpdate,
} from "./progress";
import { loadSession, type LoadDeps, type LoadedSession } from "./sessionLoader";
import { t } from "./l10n/uiTranslate";
import { setActiveSession } from "./commands/openLatest";

function progressMessage(update: MindMapProgressUpdate): string {
  return typeof update === "string" ? update : (update.message ?? "");
}

export function progressTitle(): string {
  return t(
    "ui.progress.analyzingSession.title",
    "Agent Mind Map: Analyzing session…"
  );
}

export async function withCancellableProgress<T>(
  run: (ctx: {
    signal: AbortSignal;
    progress: MindMapProgress;
  }) => Promise<T>,
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
      t(
        "ui.loading.transcriptUpdatedReanalyzing",
        "Transcript updated, re-analyzing…"
      )
    );
    try {
      const refreshed = await withCancellableProgress(
        ({ signal, progress }) =>
          loadSession(
            session.session,
            { context, signal, progress },
            { forceRefresh: true }
          ),
        progressTitle(),
        currentPanel
      );
      if (refreshed) {
        setActiveSession(refreshed);
        MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
      }
    } finally {
      MindMapPanel.getCurrent()?.setLoading(false);
    }
  });
}
