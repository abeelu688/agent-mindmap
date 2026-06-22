import { analyzeSession, listSessions, type LoadedSession } from "@agent-mindmap/core";
import { ensureModelSelected } from "../llmOptions";
import { t } from "../l10n/uiTranslate";
import { MindMapPanel } from "../webview/MindMapPanel";
import { withCancellableProgress, progressTitle, attachTranscriptWatch } from "../progressHelpers";
import { buildAnalyzeSessionDeps, buildHostAccess } from "../adapters/coreUseCaseDeps";
import { notifyWarning } from "../notify";
import type * as vscode from "vscode";

let activeSession: LoadedSession | undefined;
export function getActiveSession(): LoadedSession | undefined {
  return activeSession;
}
export function setActiveSession(session: LoadedSession | undefined): void {
  activeSession = session;
}

export async function commandOpenLatest(context: vscode.ExtensionContext): Promise<void> {
  if (!(await ensureModelSelected(context))) {
    return;
  }
  const panel = MindMapPanel.createOrShow(context.extensionUri);
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const handle = await withCancellableProgress(
      async ({ signal, progress }) => {
        const discovered = await listSessions({ hostAccess: buildHostAccess(context) });
        if (!discovered || !discovered.sessions.length) {
          if (discovered) {
            notifyWarning(
              (await buildHostAccess(context).getActiveHost()).emptyTranscriptsHint(
                discovered.scanDir
              )
            );
          }
          return undefined;
        }
        return analyzeSession(
          discovered.sessions[0]!,
          buildAnalyzeSessionDeps(context, panel, signal, progress),
          {}
        );
      },
      progressTitle(),
      panel
    );
    if (handle) {
      setActiveSession(handle.result);
      panel.setMindMapData(handle.result.mindMap);
      attachTranscriptWatch(panel, handle.result, context);
    }
  } finally {
    panel.setLoading(false);
  }
}
