import * as os from "os";
import * as path from "path";

export type McpServersConfig = {
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
};

/** Installation scope: `project` writes workspace-local config, `user` writes
 *  global config shared across all projects. */
export type McpScope = "project" | "user";

export function cursorMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "mcp.json");
}

/** Claude Code project-scoped MCP config at the workspace root. */
export function claudeMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".mcp.json");
}

/** Cursor user-scoped (global) MCP config: `~/.cursor/mcp.json`. */
export function cursorMcpConfigPathGlobal(): string {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

/** Claude Code user-scoped (global) MCP config: `~/.claude.json`. Note this is
 *  NOT `~/.mcp.json` - the global file lives at the Claude config root and is
 *  shared with other Claude Code settings, so only `mcpServers` is merged. */
export function claudeMcpConfigPathGlobal(): string {
  return path.join(os.homedir(), ".claude.json");
}

/** Resolve the Cursor MCP config path for the given scope. */
export function resolveCursorMcpConfigPath(scope: McpScope, workspaceRoot: string): string {
  return scope === "user" ? cursorMcpConfigPathGlobal() : cursorMcpConfigPath(workspaceRoot);
}

/** Resolve the Claude Code MCP config path for the given scope. */
export function resolveClaudeMcpConfigPath(scope: McpScope, workspaceRoot: string): string {
  return scope === "user" ? claudeMcpConfigPathGlobal() : claudeMcpConfigPath(workspaceRoot);
}

export function agentMindmapMcpServerEntry(
  serverEntry: string,
  storeDir: string
): NonNullable<McpServersConfig["mcpServers"]>[string] {
  return {
    command: "node",
    args: [serverEntry],
    env: {
      AGENT_MINDMAP_STORE_DIR: storeDir,
    },
  };
}

export function mergeAgentMindmapIntoConfig(
  existing: McpServersConfig | undefined,
  serverEntry: string,
  storeDir: string
): McpServersConfig {
  const mcpServers = { ...(existing?.mcpServers ?? {}) };
  mcpServers["agent-mindmap"] = agentMindmapMcpServerEntry(serverEntry, storeDir);
  return { ...existing, mcpServers };
}

export type McpInstallResult = {
  cursorConfigPath?: string;
  claudeConfigPath?: string;
};
