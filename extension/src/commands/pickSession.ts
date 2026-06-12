import * as vscode from "vscode";
import { pickSession, type LoadedSession } from "../sessionLoader";
import { ensureModelSelected } from "../llmOptions";
import { t } from "../l10n/uiTranslate";
import { MindMapPanel } from "../webview/MindMapPanel";
import {
  withCancellableProgress,
  progressTitle,
  attachTranscriptWatch,
} from "../progressHelpers";
import { setActiveSession } from "./openLatest";

export async function commandPickSession(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!(await ensureModelSelected(context))) {
    return;
  }
  const panel = MindMapPanel.createOrShow(context.extensionUri);
  panel.setLoading(true, t("ui.loading.preparing", "Understanding conversation…"));
  try {
    const loaded = await withCancellableProgress(
      ({ signal, progress }) =>
        pickSession({ context, signal, progress }),
      progressTitle(),
      panel
    );
    if (loaded) {
      setActiveSession(loaded);
      panel.setMindMapData(loaded.mindMap);
      attachTranscriptWatch(panel, loaded, context);
    }
  } finally {
    panel.setLoading(false);
  }
}
