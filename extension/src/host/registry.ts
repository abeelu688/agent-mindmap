import * as fs from "fs/promises";
import * as vscode from "vscode";
import { claudeHost } from "./claudeHost";
import { cursorHost } from "./cursorHost";
import type { AgentHost, AgentHostId, HostSetting } from "./types";

const HOSTS: Record<AgentHostId, AgentHost> = {
  cursor: cursorHost,
  "claude-code": claudeHost,
};

const WORKSPACE_HOST_KEY = "agentMindmap.resolvedHostId";

let cachedHost: AgentHost | undefined;
let cacheKey: string | undefined;

function readHostSetting(): HostSetting {
  const raw = vscode.workspace
    .getConfiguration("agentMindmap")
    .get<string>("host", "auto");
  if (raw === "cursor" || raw === "claude-code" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export function getHostById(id: AgentHostId): AgentHost {
  return HOSTS[id];
}

export function resetHostCache(): void {
  cachedHost = undefined;
  cacheKey = undefined;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function latestSessionMtime(
  host: AgentHost,
  workspacePath: string
): Promise<number> {
  const scanDir = host.getSessionsScanDir(workspacePath);
  if (!scanDir || !(await pathExists(scanDir))) {
    return 0;
  }
  const slug = host.encodeWorkspacePath(workspacePath);
  const sessions = await host.listSessions(scanDir, {
    projectSlug: slug,
    projectPath: workspacePath,
  });
  return sessions.reduce((max, s) => Math.max(max, s.mtimeMs), 0);
}

async function pickHostWhenAmbiguous(
  workspacePath: string,
  context: vscode.ExtensionContext | undefined
): Promise<AgentHostId> {
  const items = [
    {
      label: "Cursor",
      description: cursorHost.getSessionsScanDir(workspacePath) ?? "",
      id: "cursor" as const,
    },
    {
      label: "Claude Code",
      description: claudeHost.getSessionsScanDir(workspacePath) ?? "",
      id: "claude-code" as const,
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder:
      "Both Cursor and Claude Code transcripts exist for this workspace. Which should Agent Mind Map use?",
  });
  const id = picked?.id ?? "cursor";
  if (context) {
    await context.workspaceState.update(WORKSPACE_HOST_KEY, id);
  }
  return id;
}

async function resolveAutoHost(
  workspacePath: string | undefined,
  context: vscode.ExtensionContext | undefined
): Promise<AgentHostId> {
  if (/cursor/i.test(vscode.env.appName)) {
    return "cursor";
  }

  const pinned = context?.workspaceState.get<AgentHostId>(WORKSPACE_HOST_KEY);
  if (pinned === "cursor" || pinned === "claude-code") {
    return pinned;
  }

  if (!workspacePath) {
    return "cursor";
  }

  const [cursorMtime, claudeMtime] = await Promise.all([
    latestSessionMtime(cursorHost, workspacePath),
    latestSessionMtime(claudeHost, workspacePath),
  ]);

  if (cursorMtime === 0 && claudeMtime === 0) {
    return "cursor";
  }
  if (cursorMtime > 0 && claudeMtime === 0) {
    return "cursor";
  }
  if (claudeMtime > 0 && cursorMtime === 0) {
    return "claude-code";
  }
  if (cursorMtime === claudeMtime) {
    return pickHostWhenAmbiguous(workspacePath, context);
  }
  return cursorMtime > claudeMtime ? "cursor" : "claude-code";
}

export async function resolveHostId(
  context?: vscode.ExtensionContext
): Promise<AgentHostId> {
  const setting = readHostSetting();
  if (setting !== "auto") {
    return setting;
  }
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return resolveAutoHost(workspacePath, context);
}

export async function getActiveHost(
  context?: vscode.ExtensionContext
): Promise<AgentHost> {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const setting = readHostSetting();
  const key = `${setting}:${workspacePath}`;
  if (cachedHost && cacheKey === key) {
    return cachedHost;
  }
  const id = await resolveHostId(context);
  cachedHost = HOSTS[id];
  cacheKey = key;
  return cachedHost;
}

export function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getWorkspaceSlug(host: AgentHost): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return host.encodeWorkspacePath(folder.uri.fsPath);
}
