/**
 * Extension adapter for LlmDumpDeps — implements the core port
 * using VS Code configuration, store paths, and extension logging.
 */
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { LLM_DUMP_FOLDER, dumpDirForWorkspace } from "@agent-mindmap/core";
import { getStoreDir } from "../paths";
import { mindMapLog } from "../webview/MindMapLog";
import { agentLog } from "../log";
import type { LlmDumpDeps } from "@agent-mindmap/core";

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export const extensionLlmDumpDeps: LlmDumpDeps = {
  isDumpEnabled() {
    return (
      vscode.workspace.getConfiguration("agentMindmap").get<boolean>("llm.dumpIo", false) ?? false
    );
  },

  resolveDumpRoots() {
    const custom = vscode.workspace
      .getConfiguration("agentMindmap")
      .get<string>("llm.dumpDir", "")
      .trim();
    if (custom) {
      return [expandHome(custom)];
    }
    const roots: string[] = [path.join(getStoreDir(), LLM_DUMP_FOLDER)];
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      const wsRoot = dumpDirForWorkspace(folder.uri.fsPath);
      if (!roots.includes(wsRoot)) {
        roots.push(wsRoot);
      }
    }
    return roots;
  },

  logInfo(message: string) {
    mindMapLog(message);
  },

  logWarn(message: string, data?: Record<string, unknown>) {
    agentLog.warn(message, data);
  },
};
