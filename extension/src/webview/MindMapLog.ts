import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

/** Output channel: View → Output → "Agent Mind Map". */
export function mindMapLog(message: string): void {
  if (!channel) {
    channel = vscode.window.createOutputChannel("Agent Mind Map");
  }
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  channel.appendLine(`[${stamp}] ${message}`);
}
