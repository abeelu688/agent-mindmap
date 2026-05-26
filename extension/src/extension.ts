import * as vscode from "vscode";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  loadLatestSession,
  loadSession,
  pickSession,
  type LoadedSession,
} from "./sessionLoader";

let activeSession: LoadedSession | undefined;
let extensionContext: vscode.ExtensionContext;

function progressTitle(): string {
  return "Agent Mind Map: 正在分析会话…";
}

async function withCancellableProgress<T>(
  run: (signal: AbortSignal) => Promise<T>
): Promise<T | undefined> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: progressTitle(),
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        return await run(controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          return undefined;
        }
        throw err;
      } finally {
        sub.dispose();
      }
    }
  );
}

async function showMindMap(loaded: LoadedSession): Promise<void> {
  activeSession = loaded;

  const panel = MindMapPanel.createOrShow(extensionContext.extensionUri);
  panel.setMindMapData(loaded.mindMap);
  panel.watchTranscript(loaded.session.filePath, async () => {
    if (!activeSession) {
      return;
    }
    const refreshed = await withCancellableProgress((signal) =>
      loadSession(activeSession!.session, {
        context: extensionContext,
        signal,
      })
    );
    if (refreshed) {
      activeSession = refreshed;
      MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand("agent-mindmap.openLatest", async () => {
      const loaded = await withCancellableProgress((signal) =>
        loadLatestSession({ context, signal })
      );
      if (loaded) {
        await showMindMap(loaded);
      }
    }),

    vscode.commands.registerCommand("agent-mindmap.pickSession", async () => {
      const loaded = await withCancellableProgress((signal) =>
        pickSession({ context, signal })
      );
      if (loaded) {
        await showMindMap(loaded);
      }
    }),

    vscode.commands.registerCommand("agent-mindmap.refresh", async () => {
      if (!activeSession) {
        const loaded = await withCancellableProgress((signal) =>
          loadLatestSession({ context, signal })
        );
        if (loaded) {
          await showMindMap(loaded);
        }
        return;
      }
      const refreshed = await withCancellableProgress((signal) =>
        loadSession(activeSession!.session, { context, signal })
      );
      if (refreshed) {
        activeSession = refreshed;
        MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
        vscode.window.showInformationMessage("Agent Mind Map refreshed.");
      }
    }),

    vscode.commands.registerCommand("agent-mindmap.exportJson", async () => {
      if (!activeSession) {
        vscode.window.showWarningMessage(
          "Agent Mind Map: Open a mind map first."
        );
        return;
      }

      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showWarningMessage("Agent Mind Map: No workspace folder.");
        return;
      }

      const outDir = vscode.Uri.joinPath(folder.uri, "docs", "agent-mindmaps");
      await vscode.workspace.fs.createDirectory(outDir);
      const fileName = `${activeSession.session.id}.json`;
      const fileUri = vscode.Uri.joinPath(outDir, fileName);
      const content = JSON.stringify(activeSession.mindMap, null, 2);
      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(content, "utf8")
      );
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage(
        `Exported mind map to docs/agent-mindmaps/${fileName}`
      );
    })
  );
}

export function deactivate(): void {
  activeSession = undefined;
}
