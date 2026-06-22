/**
 * CLI host access — resolves the active host for a given cwd.
 */
import * as os from "os";
import * as path from "path";
import {
  createCursorHost,
  createClaudeHost,
  type AgentHost,
  type AgentHostId,
} from "@agent-mindmap/core";
import type { CliConfigStore } from "../config/configStore";

function getCursorProjectsRoot(): string {
  return path.join(os.homedir(), ".cursor");
}

function getClaudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/** Build an AgentHost for the given host ID. */
export function buildCliHost(cwd: string, hostId?: AgentHostId): AgentHost {
  const id = hostId ?? "cursor";
  if (id === "claude-code") {
    return createClaudeHost(getClaudeProjectsRoot, () => "Install Claude CLI from claude.ai");
  }
  return createCursorHost(getCursorProjectsRoot, () => "Install Cursor CLI from cursor.sh");
}

/** Auto-detect the best host for a given cwd and config. */
export async function detectHost(cwd: string, config: CliConfigStore): Promise<AgentHost> {
  const hostSetting = config.get<string>("host") ?? "auto";

  if (hostSetting === "cursor") {
    return createCursorHost(getCursorProjectsRoot, () => "Install Cursor CLI from cursor.sh");
  }
  if (hostSetting === "claude-code") {
    return createClaudeHost(getClaudeProjectsRoot, () => "Install Claude CLI from claude.ai");
  }

  // Auto-detect
  const cursorHost = createCursorHost(getCursorProjectsRoot, () => "");
  const claudeHost = createClaudeHost(getClaudeProjectsRoot, () => "");

  const cursorDir = cursorHost.getSessionsScanDir(cwd);
  const claudeDir = claudeHost.getSessionsScanDir(cwd);

  let cursorExists = false;
  let claudeExists = false;

  const { access } = await import("fs/promises");
  if (cursorDir) {
    try {
      await access(cursorDir);
      cursorExists = true;
    } catch {
      /* not found */
    }
  }
  if (claudeDir) {
    try {
      await access(claudeDir);
      claudeExists = true;
    } catch {
      /* not found */
    }
  }

  if (cursorExists && !claudeExists) return cursorHost;
  if (claudeExists && !cursorExists) return claudeHost;

  // Default to cursor
  return createCursorHost(getCursorProjectsRoot, () => "Install Cursor CLI from cursor.sh");
}
