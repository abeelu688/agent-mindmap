import * as vscode from "vscode";
import { exportSession } from "@agent-mindmap/core";
import { MindMapPanel } from "../webview/MindMapPanel";
import { openMindMapPackage } from "../export/openMindMapPackage";
import { readMindMapUiConfig } from "../ui/mindMapUiConfig";
import { notifyWarning, notifyError } from "../notify";
import { t } from "../l10n/uiTranslate";
import { buildLogger } from "../adapters/coreUseCaseDeps";

export async function commandDownloadPackage(extensionUri: vscode.Uri): Promise<void> {
  const panel = MindMapPanel.getCurrent();
  const mindMap = panel?.getMindMapData();
  if (!mindMap) {
    notifyWarning(t("ui.warning.openMindMapFirst", "Agent Mind Map: Open a mind map first."));
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
  try {
    const result = await exportSession({
      mindMapSink: { refreshMindMap() {}, showInfo() {} },
      prompter: {
        showQuickPick: async () => undefined,
        showInputBox: async () => undefined,
        showWarningMessage: async () => undefined,
        showInformationMessage: async () => undefined,
      },
      logger: buildLogger(),
      mindMap,
      mediaDir: vscode.Uri.joinPath(extensionUri, "media").fsPath,
      outDir: picked[0]!.fsPath,
      uiConfig: readMindMapUiConfig(),
    });
    if (!result) {
      return;
    }
    const openBrowser = t("ui.download.choice.openInBrowser", "Open in browser");
    const showFolder = t("ui.download.choice.showInExplorer", "Show in file manager");
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
