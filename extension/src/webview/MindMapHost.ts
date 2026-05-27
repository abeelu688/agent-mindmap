import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { MindMapRoot, NodeOrigin } from "../transcript/types";
import { applyUiSettingToWorkspace } from "../ui/applyUiSettingWorkspace";
import {
  readMindMapUiConfig,
  resolveThemeFilePath,
} from "../ui/mindMapUiConfig";
import type { MindMapUiOptions } from "../ui/mindMapUiTypes";
import { buildMindMapHtml } from "./mindMapHtml";
import { mindMapLog } from "./MindMapLog";

export type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin; nodeLabel?: string }
  | { type: "updateUiSetting"; key: "preset" | "direction"; value: string }
  | { type: "requestDownload" };

export type ExtensionToWebviewMessage =
  | { type: "setData"; data: MindMapRoot }
  | { type: "setUi"; ui: MindMapUiOptions };

export type NodeClickedListener = (payload: {
  origin: NodeOrigin;
  nodeLabel?: string;
}) => void;

export type DownloadRequestedListener = () => void;

/**
 * Shared mind-map webview logic for editor panels and other hosts. Keeps
 * state across hide/show when the host enables retainContextWhenHidden.
 */
export class MindMapHost {
  private static current: MindMapHost | undefined;
  private static nodeClickedListener: NodeClickedListener | undefined;
  private static downloadRequestedListener: DownloadRequestedListener | undefined;
  private static bootData: MindMapRoot | undefined;
  private static bootTitle: string | undefined;

  private webviewReady = false;
  private pendingData: MindMapRoot | undefined;
  private lastMindMapData: MindMapRoot | undefined;
  private fileWatcher: fs.FSWatcher | undefined;
  private themeFileWatcher: vscode.FileSystemWatcher | undefined;
  private themeFsWatcher: fs.FSWatcher | undefined;
  private watchPath: string | undefined;
  private refreshDebounce: ReturnType<typeof setTimeout> | undefined;
  private themeFileDebounce: ReturnType<typeof setTimeout> | undefined;
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
          this.postUi();
          this.updateThemeFileWatcher();
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
              MindMapHost.nodeClickedListener({
                origin: msg.origin,
                nodeLabel: msg.nodeLabel,
              });
            } catch (err) {
              mindMapLog(`nodeClicked listener threw: ${String(err)}`);
            }
          }
        }
        if (msg.type === "updateUiSetting") {
          void this.handleUpdateUiSetting(msg.key, msg.value);
        }
        if (msg.type === "requestDownload") {
          if (MindMapHost.downloadRequestedListener) {
            MindMapHost.downloadRequestedListener();
          } else {
            mindMapLog("WARN: requestDownload with no listener registered");
          }
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("agentMindmap.ui")) {
          this.postUi();
          this.updateThemeFileWatcher();
        }
      })
    );
  }

  public static onNodeClicked(listener: NodeClickedListener | undefined): void {
    MindMapHost.nodeClickedListener = listener;
  }

  public static onDownloadRequested(
    listener: DownloadRequestedListener | undefined
  ): void {
    MindMapHost.downloadRequestedListener = listener;
  }

  public getMindMapData(): MindMapRoot | undefined {
    return this.lastMindMapData;
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
    this.lastMindMapData = data;
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

  private async handleUpdateUiSetting(
    key: string,
    value: string
  ): Promise<void> {
    const result = await applyUiSettingToWorkspace(key, value);
    if (result.ok) {
      mindMapLog(`ui: updated ${key}=${value} (workspace)`);
      return;
    }
    if (result.reason === "no_workspace") {
      void vscode.window.showWarningMessage(
        "Agent Mind Map: 请先打开文件夹工作区，才能将样式写入 .vscode/settings.json。"
      );
      return;
    }
    mindMapLog(`ui: rejected invalid setting ${key}=${value}`);
  }

  private postUi(): void {
    if (!this.webviewReady) {
      return;
    }
    const ui = readMindMapUiConfig();
    const msg: ExtensionToWebviewMessage = { type: "setUi", ui };
    void this.webview.postMessage(msg);
  }

  private postData(data: MindMapRoot): void {
    this.lastMindMapData = data;
    this.postUi();
    const msg: ExtensionToWebviewMessage = { type: "setData", data };
    const stats = MindMapHost.statsForOriginCoverage(data);
    mindMapLog(
      `postData → total=${stats.total} withOrigin=${stats.withOrigin}` +
        ` rootOrigin=${stats.rootOrigin}`
    );
    void this.webview.postMessage(msg);
  }

  private updateThemeFileWatcher(): void {
    if (this.themeFileWatcher) {
      this.themeFileWatcher.dispose();
      this.themeFileWatcher = undefined;
    }
    if (this.themeFsWatcher) {
      this.themeFsWatcher.close();
      this.themeFsWatcher = undefined;
    }
    if (this.themeFileDebounce) {
      clearTimeout(this.themeFileDebounce);
      this.themeFileDebounce = undefined;
    }

    const raw = vscode.workspace
      .getConfiguration("agentMindmap")
      .get<string>("ui.themeFile", "")
      .trim();
    if (!raw) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = folder?.uri.fsPath;
    const resolved = resolveThemeFilePath(raw, workspaceRoot);
    if (!resolved) {
      return;
    }

    const onThemeFileChange = (): void => {
      if (this.themeFileDebounce) {
        clearTimeout(this.themeFileDebounce);
      }
      this.themeFileDebounce = setTimeout(() => {
        this.themeFileDebounce = undefined;
        this.postUi();
      }, 200);
    };

    const inWorkspace =
      workspaceRoot && MindMapHost.isPathInside(resolved, workspaceRoot);

    if (inWorkspace && folder) {
      const rel = path.relative(workspaceRoot!, resolved);
      const pattern = new vscode.RelativePattern(folder, rel);
      this.themeFileWatcher = vscode.workspace.createFileSystemWatcher(
        pattern,
        false,
        false,
        false
      );
      this.themeFileWatcher.onDidChange(onThemeFileChange);
      this.themeFileWatcher.onDidCreate(onThemeFileChange);
      return;
    }

    try {
      this.themeFsWatcher = fs.watch(resolved, onThemeFileChange);
    } catch (err) {
      mindMapLog(
        `ui.themeFile: could not watch ${resolved}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private static isPathInside(filePath: string, dir: string): boolean {
    const rel = path.relative(dir, filePath);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
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
    if (this.themeFileWatcher) {
      this.themeFileWatcher.dispose();
      this.themeFileWatcher = undefined;
    }
    if (this.themeFsWatcher) {
      this.themeFsWatcher.close();
      this.themeFsWatcher = undefined;
    }
    if (this.themeFileDebounce) {
      clearTimeout(this.themeFileDebounce);
      this.themeFileDebounce = undefined;
    }
    while (this.disposables.length) {
      const d = this.disposables.pop();
      d?.dispose();
    }
  }
}
