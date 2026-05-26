import * as fs from "fs";
import * as vscode from "vscode";
import type { MindMapRoot, NodeOrigin } from "../transcript/types";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin };

export type ExtensionToWebviewMessage = {
  type: "setData";
  data: MindMapRoot;
};

export type NodeClickedListener = (origin: NodeOrigin) => void;

export class MindMapPanel {
  public static readonly viewType = "agentMindmap";

  private static current: MindMapPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private pendingData: MindMapRoot | undefined;
  private fileWatcher: fs.FSWatcher | undefined;
  private watchPath: string | undefined;
  private refreshDebounce: ReturnType<typeof setTimeout> | undefined;
  private nodeClickedListener: NodeClickedListener | undefined;

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
          MindMapPanel.log(`webview: ${msg.message}`);
        }
        if (msg.type === "nodeClicked") {
          MindMapPanel.log(
            `nodeClicked received (${msg.origin.refs.length} ref(s))`
          );
          if (!this.nodeClickedListener) {
            MindMapPanel.log(
              "WARN: no nodeClicked listener registered on the panel"
            );
          }
          if (this.nodeClickedListener) {
            try {
              this.nodeClickedListener(msg.origin);
            } catch (err) {
              MindMapPanel.log(`nodeClicked listener threw: ${String(err)}`);
            }
          }
        }
      },
      null,
      this.disposables
    );
  }

  private static statsForOriginCoverage(data: MindMapRoot): {
    total: number;
    withOrigin: number;
    rootOrigin: number;
  } {
    let total = 0;
    let withOrigin = 0;
    const walk = (n: MindMapRoot): void => {
      total += 1;
      if (n.data.origin?.refs?.length) {
        withOrigin += 1;
      }
      if (n.children) {
        for (const c of n.children) walk(c);
      }
    };
    walk(data);
    return {
      total,
      withOrigin,
      rootOrigin: data.data.origin?.refs?.length ?? 0,
    };
  }

  private static channel: vscode.OutputChannel | undefined;

  /**
   * Lazily-created shared Output channel — surface webview <-> extension
   * traffic to the user without forcing them into the webview DevTools.
   * Read in Cursor / VS Code via View → Output → "Agent Mind Map".
   */
  public static log(message: string): void {
    if (!MindMapPanel.channel) {
      MindMapPanel.channel = vscode.window.createOutputChannel("Agent Mind Map");
    }
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    MindMapPanel.channel.appendLine(`[${stamp}] ${message}`);
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

  /**
   * Register a listener for click events on a mind-map node. Replaces any
   * previous listener; the panel keeps a single active subscriber.
   */
  public onNodeClicked(listener: NodeClickedListener | undefined): void {
    this.nodeClickedListener = listener;
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
    // Diagnostic: count nodes carrying origin vs total. Lets us tell at a
    // glance whether the renderer attached anything for this tree.
    const stats = MindMapPanel.statsForOriginCoverage(data);
    MindMapPanel.log(
      `postData → total=${stats.total} withOrigin=${stats.withOrigin}` +
        ` rootOrigin=${stats.rootOrigin}`
    );
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
