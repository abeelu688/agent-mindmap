import * as vscode from "vscode";
import { MindMapPanel } from "./webview/MindMapPanel";
import {
  loadLatestSession,
  loadSession,
  pickSession,
} from "./sessionLoader";
import type { LoadedSession } from "./sessionLoader";

let activeSession: LoadedSession | undefined;

let extensionUri: vscode.Uri;

async function showMindMap(loaded: LoadedSession): Promise<void> {
  activeSession = loaded;

  const panel = MindMapPanel.createOrShow(extensionUri);
  panel.setMindMapData(loaded.mindMap);
  panel.watchTranscript(loaded.session.filePath, async () => {
    if (!activeSession) {
      return;
    }
    const refreshed = await loadSession(activeSession.session);
    activeSession = refreshed;
    MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
  });
}

export function activate(context: vscode.ExtensionContext): void {
  extensionUri = context.extensionUri;

  context.subscriptions.push(
    vscode.commands.registerCommand("agent-mindmap.openLatest", async () => {
      const loaded = await loadLatestSession();
      if (loaded) {
        await showMindMap(loaded);
      }
    }),

    vscode.commands.registerCommand("agent-mindmap.pickSession", async () => {
      const loaded = await pickSession();
      if (loaded) {
        await showMindMap(loaded);
      }
    }),

    vscode.commands.registerCommand("agent-mindmap.refresh", async () => {
      if (!activeSession) {
        const loaded = await loadLatestSession();
        if (loaded) {
          await showMindMap(loaded);
        }
        return;
      }
      const refreshed = await loadSession(activeSession.session);
      activeSession = refreshed;
      MindMapPanel.getCurrent()?.setMindMapData(refreshed.mindMap);
      vscode.window.showInformationMessage("Agent Mind Map refreshed.");
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
