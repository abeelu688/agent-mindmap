import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;
let unavailable = false;

/** Output channel: View → Output → "Agent Mind Map". No-op outside VS Code (e.g. vitest). */
export function mindMapLog(message: string): void {
  if (unavailable) {
    return;
  }
  if (!channel) {
    try {
      channel = vscode.window.createOutputChannel("Agent Mind Map");
    } catch {
      unavailable = true;
      return;
    }
  }
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  channel.appendLine(`[${stamp}] ${message}`);
}
