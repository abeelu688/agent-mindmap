import * as fs from "fs";
import * as vscode from "vscode";
import type { MindMapRoot } from "../transcript/types";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string };

export type ExtensionToWebviewMessage = {
  type: "setData";
  data: MindMapRoot;
};

export class MindMapPanel {
  public static readonly viewType = "agentMindmap";

  private static current: MindMapPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pendingData: MindMapRoot | undefined;
  private fileWatcher: fs.FSWatcher | undefined;
  private watchPath: string | undefined;
  private refreshDebounce: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => {
        if (msg.type === "ready" && this.pendingData) {
          this.postData(this.pendingData);
        }
        if (msg.type === "log") {
          console.log("[agent-mindmap webview]", msg.message);
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(extensionUri: vscode.Uri): MindMapPanel {
    if (MindMapPanel.current) {
      MindMapPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return MindMapPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      MindMapPanel.viewType,
      "Agent Mind Map",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
        ],
      }
    );

    MindMapPanel.current = new MindMapPanel(panel, extensionUri);
    return MindMapPanel.current;
  }

  public static getCurrent(): MindMapPanel | undefined {
    return MindMapPanel.current;
  }

  public setMindMapData(data: MindMapRoot): void {
    this.pendingData = data;
    this.postData(data);
  }

  public setTitle(title: string): void {
    this.panel.title = title;
  }

  public watchTranscript(filePath: string, onRefresh: () => void): void {
    this.unwatchTranscript();
    const autoRefresh = vscode.workspace
      .getConfiguration("agentMindmap")
      .get<boolean>("autoRefresh", false);
    if (!autoRefresh) {
      return;
    }

    this.watchPath = filePath;
    try {
      this.fileWatcher = fs.watch(filePath, () => {
        if (this.refreshDebounce) {
          clearTimeout(this.refreshDebounce);
        }
        this.refreshDebounce = setTimeout(() => {
          onRefresh();
        }, 1500);
      });
      this.disposables.push({
        dispose: () => this.unwatchTranscript(),
      });
    } catch {
      // ignore watch errors
    }
  }

  private unwatchTranscript(): void {
    if (this.refreshDebounce) {
      clearTimeout(this.refreshDebounce);
      this.refreshDebounce = undefined;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = undefined;
    }
    this.watchPath = undefined;
  }

  private postData(data: MindMapRoot): void {
    const msg: ExtensionToWebviewMessage = { type: "setData", data };
    void this.panel.webview.postMessage(msg);
  }

  private getHtml(): string {
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.js")
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "webview.css")
    );
    const cspSource = this.panel.webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; img-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Agent Mind Map</title>
</head>
<body>
  <div id="app"><div id="mindMapContainer"></div></div>
  <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    MindMapPanel.current = undefined;
    this.unwatchTranscript();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
