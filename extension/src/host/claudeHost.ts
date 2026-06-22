import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { createClaudeHost, type AgentHost } from "@agent-mindmap/core";
import { cliMissingHintSummary } from "@agent-mindmap/core";

export function getClaudeProjectsRoot(): string {
  const override = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("claudeProjectsDir");
  if (override && override.trim()) {
    return expandHome(override.trim());
  }
  return path.join(os.homedir(), ".claude", "projects");
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

export const claudeHost: AgentHost = createClaudeHost(
  () => getClaudeProjectsRoot(),
  () => cliMissingHintSummary("claude-code")
);
