import type { MindMapRoot } from "../transcript/types";

/**
 * Sink for mind map updates — decouples core from VS Code panel / webview.
 *
 * The extension implements this with `MindMapPanel` + `vscode.window.showInformationMessage`;
 * the CLI implements it with `console.log` / file writes; tests use `noopMindMapSink`.
 */
export interface MindMapSink {
  /** Refresh the mind map for the given session or project. */
  refreshMindMap(storeDir: string, sessionId: string, mindMap: MindMapRoot): void;
  /** Show an informational message to the user. */
  showInfo(message: string): void;
}

/** No-op sink for non-interactive / test contexts. */
export const noopMindMapSink: MindMapSink = {
  refreshMindMap() {},
  showInfo() {},
};
