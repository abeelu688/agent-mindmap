import * as vscode from "vscode";
import type { MindMapRoot } from "../transcript/types";
import {
  MindMapHost,
  type DownloadRequestedListener,
  type NodeClickedListener,
} from "./MindMapHost";

/**
 * Mind map as an editor-area {@link vscode.WebviewPanel} (code editor strip),
 * not the activity-bar sidebar. Transcript markdown opens in the same column
 * and covers the map tab until the user closes it.
 */
export class MindMapPanel {
  public static readonly viewType = "agentMindmap";

  private static current: MindMapPanel | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly host: MindMapHost
  ) {
    this.panel.onDidDispose(() => {
      if (MindMapPanel.current === this) {
        MindMapPanel.current = undefined;
      }
      MindMapHost.disposeCurrent();
    });
  }

  public static createOrShow(extensionUri: vscode.Uri): MindMapPanel {
    if (MindMapPanel.current) {
      MindMapPanel.current.reveal();
      return MindMapPanel.current;
    }

    void vscode.commands.executeCommand(
      "workbench.action.focusFirstEditorGroup"
    );

    const panel = vscode.window.createWebviewPanel(
      MindMapPanel.viewType,
      "Agent Mind Map",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      }
    );

    const host = MindMapHost.attach(panel.webview, extensionUri, panel);
    MindMapPanel.current = new MindMapPanel(panel, host);
    return MindMapPanel.current;
  }

  public static getCurrent(): MindMapPanel | undefined {
    return MindMapPanel.current;
  }

  public static onNodeClicked(listener: NodeClickedListener | undefined): void {
    MindMapHost.onNodeClicked(listener);
  }

  public static onDownloadRequested(
    listener: DownloadRequestedListener | undefined
  ): void {
    MindMapHost.onDownloadRequested(listener);
  }

  public static queueBoot(data: MindMapRoot, title?: string): void {
    MindMapHost.queueBoot(data, title);
  }

  /** Bring the map tab back to the front of the code editor group. */
  public reveal(): void {
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active);
  }

  public get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel.viewColumn;
  }

  public setMindMapData(data: MindMapRoot): void {
    this.host.setMindMapData(data);
  }

  public setLoading(active: boolean, message?: string): void {
    this.host.setLoading(active, message);
  }

  public getMindMapData(): MindMapRoot | undefined {
    return this.host.getMindMapData();
  }

  public setTitle(title: string): void {
    this.panel.title = title;
  }

  public watchTranscript(filePath: string, onRefresh: () => void): void {
    this.host.watchTranscript(filePath, onRefresh);
  }
}
