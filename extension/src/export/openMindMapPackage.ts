import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

/** Open an exported offline package in the system default browser. */
export async function openMindMapPackage(outDir: string): Promise<void> {
  const indexPath = path.join(outDir, "index.html");
  try {
    await fs.access(indexPath);
  } catch {
    void vscode.window.showErrorMessage(
      "Agent Mind Map: 所选目录不是有效的离线包（缺少 index.html）。"
    );
    return;
  }

  const ok = await vscode.env.openExternal(vscode.Uri.file(indexPath));
  if (!ok) {
    void vscode.window.showErrorMessage(
      "Agent Mind Map: 无法用系统浏览器打开 index.html。"
    );
  }
}
