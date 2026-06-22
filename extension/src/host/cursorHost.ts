import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createCursorHost, type AgentHost } from "@agent-mindmap/core";
import { cliMissingHintSummary } from "@agent-mindmap/core";

export function getCursorProjectsRoot(): string {
  const override = vscode.workspace.getConfiguration("agentMindmap").get<string>("projectsDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".cursor", "projects");
}

function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export const cursorHost: AgentHost = createCursorHost(
  () => getCursorProjectsRoot(),
  () => cliMissingHintSummary("cursor")
);
