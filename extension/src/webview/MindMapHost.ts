import * as fs from "fs";
import * as vscode from "vscode";
import type { MindMapRoot, NodeOrigin } from "../transcript/types";
import { buildMindMapHtml } from "./mindMapHtml";
import { mindMapLog } from "./MindMapLog";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin };

export type ExtensionToWebviewMessage = {
  type: "setData";
  data: MindMapRoot;
};

export type NodeClickedListener = (origin: NodeOrigin) => void;

/**
 * Shared mind-map webview logic for editor panels and other hosts. Keeps
 * state across hide/show when the host enables retainContextWhenHidden.
 */
export class MindMapHost {
  private static current: MindMapHost | undefined;
  private static nodeClickedListener: NodeClickedListener | undefined;
  private static bootData: MindMapRoot | undefined;
  private static bootTitle: string | undefined;

  private webviewReady = false;
  private pendingData: MindMapRoot | undefined;
  private fileWatcher: fs.FSWatcher | undefined;
  private watchPath: string | undefined;
  private refreshDebounce: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly webview: vscode.Webview,
    private readonly extensionUri: vscode.Uri,
    private readonly titleTarget?: { title?: string }
  ) {
    MindMapHost.current = this;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    };
    webview.html = buildMindMapHtml(webview, extensionUri);

    if (MindMapHost.bootTitle && titleTarget) {
      titleTarget.title = MindMapHost.bootTitle;
    }
    if (MindMapHost.bootData) {
      this.pendingData = MindMapHost.bootData;
      MindMapHost.bootData = undefined;
      MindMapHost.bootTitle = undefined;
    }

    this.disposables.push(
      webview.onDidReceiveMessage((msg: WebviewToExtensionMessage) => {
        if (msg.type === "ready") {
          this.webviewReady = true;
          if (this.pendingData) {
            this.postData(this.pendingData);
            this.pendingData = undefined;
          }
        }
        if (msg.type === "log") {
          mindMapLog(`webview: ${msg.message}`);
        }
        if (msg.type === "nodeClicked") {
          mindMapLog(
            `nodeClicked received (${msg.origin.refs.length} ref(s))`
          );
          if (!MindMapHost.nodeClickedListener) {
            mindMapLog(
              "WARN: no nodeClicked listener registered on the mind map view"
            );
          }
          if (MindMapHost.nodeClickedListener) {
            try {
              MindMapHost.nodeClickedListener(msg.origin);
            } catch (err) {
              mindMapLog(`nodeClicked listener threw: ${String(err)}`);
            }
          }
        }
      })
    );
  }

  public static onNodeClicked(listener: NodeClickedListener | undefined): void {
    MindMapHost.nodeClickedListener = listener;
  }

  public static getCurrent(): MindMapHost | undefined {
    return MindMapHost.current;
  }

  public static queueBoot(data: MindMapRoot, title?: string): void {
    const host = MindMapHost.current;
    if (host) {
      host.setMindMapData(data);
      if (title) {
        host.setTitle(title);
      }
      return;
    }
    MindMapHost.bootData = data;
    if (title) {
      MindMapHost.bootTitle = title;
    }
  }

  public static attach(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    titleTarget?: { title?: string }
  ): MindMapHost {
    return new MindMapHost(webview, extensionUri, titleTarget);
  }

  public static disposeCurrent(): void {
    MindMapHost.current?.dispose();
  }

  public setMindMapData(data: MindMapRoot): void {
    if (this.webviewReady) {
      this.postData(data);
    } else {
      this.pendingData = data;
    }
  }

  public setTitle(title: string): void {
    if (this.titleTarget) {
      this.titleTarget.title = title;
    }
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
    const stats = MindMapHost.statsForOriginCoverage(data);
    mindMapLog(
      `postData → total=${stats.total} withOrigin=${stats.withOrigin}` +
        ` rootOrigin=${stats.rootOrigin}`
    );
    void this.webview.postMessage(msg);
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

  private dispose(): void {
    if (MindMapHost.current === this) {
      MindMapHost.current = undefined;
    }
    this.unwatchTranscript();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
