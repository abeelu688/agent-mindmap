import * as vscode from "vscode";
import { analyzeSession, listSessions } from "@agent-mindmap/core";
import { ensureModelSelected } from "../llmOptions";
import { t } from "../l10n/uiTranslate";
import { MindMapPanel } from "../webview/MindMapPanel";
import { withCancellableProgress, progressTitle, attachTranscriptWatch } from "../progressHelpers";
import { buildAnalyzeSessionDeps, buildHostAccess } from "../adapters/coreUseCaseDeps";
import { notifyWarning } from "../notify";
import { setActiveSession } from "./openLatest";

export async function commandPickSession(context: vscode.ExtensionContext): Promise<void> {
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
        const host = await buildHostAccess(context).getActiveHost();
        const picked = await vscode.window.showQuickPick(
          discovered.sessions.map((s) => ({
            label: s.label,
            description: `${s.id.slice(0, 8)}…`,
            detail: s.id,
            session: s,
          })),
          {
            placeHolder: t(
              "ui.pickSession.placeholder",
              "Select a {0} chat session",
              host.displayName
            ),
            matchOnDescription: true,
            matchOnDetail: true,
          }
        );
        return picked
          ? analyzeSession(
              picked.session,
              buildAnalyzeSessionDeps(context, panel, signal, progress),
              {}
            )
          : undefined;
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
