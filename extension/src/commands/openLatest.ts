import { loadLatestSession, type LoadDeps, type LoadedSession } from "../sessionLoader";
import { ensureModelSelected } from "../llmOptions";
import { t } from "../l10n/uiTranslate";
import { MindMapPanel } from "../webview/MindMapPanel";
import { withCancellableProgress, progressTitle, attachTranscriptWatch } from "../progressHelpers";
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
    const loaded = await withCancellableProgress(
      ({ signal, progress }) => loadLatestSession({ context, signal, progress }),
      progressTitle(),
      panel
    );
    if (loaded) {
      activeSession = loaded;
      panel.setMindMapData(loaded.mindMap);
      attachTranscriptWatch(panel, loaded, context);
    }
  } finally {
    panel.setLoading(false);
  }
}
