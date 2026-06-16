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

export function cursorMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".cursor", "mcp.json");
}

/** Claude Code project-scoped MCP config at the workspace root. */
export function claudeMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".mcp.json");
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
  cursorConfigPath: string;
  claudeConfigPath: string;
};
