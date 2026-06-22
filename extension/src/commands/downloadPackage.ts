import * as vscode from "vscode";
import { MindMapPanel } from "../webview/MindMapPanel";
import { exportMindMapPackage } from "@agent-mindmap/core";
import { openMindMapPackage } from "../export/openMindMapPackage";
import { readMindMapUiConfig } from "../ui/mindMapUiConfig";
import { notifyWarning, notifyError } from "../notify";
import { t } from "../l10n/uiTranslate";

export async function commandDownloadPackage(
  extensionUri: vscode.Uri
): Promise<void> {
  const panel = MindMapPanel.getCurrent();
  const mindMap = panel?.getMindMapData();
  if (!mindMap) {
    notifyWarning(
      t("ui.warning.openMindMapFirst", "Agent Mind Map: Open a mind map first.")
    );
    return;
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: t("ui.download.pickFolderLabel", "Select download folder"),
  });
  if (!picked?.length) {
    return;
  }

  const outDir = picked[0]!.fsPath;

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t("ui.download.exporting.title", "Agent Mind Map: Exporting…"),
        cancellable: false,
      },
      async () =>
        exportMindMapPackage({
          outDir,
          mindMap,
          mediaDir: vscode.Uri.joinPath(extensionUri, "media").fsPath,
          ui: readMindMapUiConfig(),
          onWarning: (msg) => void vscode.window.showWarningMessage(msg),
        })
    );

    const openBrowser = t(
      "ui.download.choice.openInBrowser",
      "Open in browser"
    );
    const showFolder = t(
      "ui.download.choice.showInExplorer",
      "Show in file manager"
    );
    const choice = await vscode.window.showInformationMessage(
      t(
        "ui.download.exported.summary",
        "Exported mind map and {0} transcript(s) to the selected folder.",
        result.transcriptCount
      ),
      openBrowser,
      showFolder
    );
    if (choice === openBrowser) {
      await openMindMapPackage(result.outDir);
    } else if (choice === showFolder) {
      await vscode.env.openExternal(vscode.Uri.file(result.outDir));
    }
  } catch (err) {
    notifyError(
      t(
        "ui.download.exportFailed",
        "Agent Mind Map: Export failed: {0}",
        err instanceof Error ? err.message : String(err)
      ),
      err
    );
  }
}
