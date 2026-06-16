import { describe, expect, it } from "vitest";
import {
  claudeMcpConfigPath,
  cursorMcpConfigPath,
  mergeAgentMindmapIntoConfig,
} from "../extension/src/mcp/mcpConfigCore";

describe("mcp install config paths", () => {
  it("resolves Cursor and Claude Code config paths", () => {
    const root = "/home/example/proj";
    expect(cursorMcpConfigPath(root)).toBe("/home/example/proj/.cursor/mcp.json");
    expect(claudeMcpConfigPath(root)).toBe("/home/example/proj/.mcp.json");
  });
});

describe("mergeAgentMindmapIntoConfig", () => {
  it("preserves existing servers and adds agent-mindmap", () => {
    const merged = mergeAgentMindmapIntoConfig(
      {
        mcpServers: {
          other: { command: "echo", args: ["hi"] },
        },
      },
      "/tmp/agent-mindmap-mcp/index.js",
      "/home/me/.agent-mindmap"
    );
    expect(merged.mcpServers?.other.command).toBe("echo");
    expect(merged.mcpServers?.["agent-mindmap"]).toEqual({
      command: "node",
      args: ["/tmp/agent-mindmap-mcp/index.js"],
      env: { AGENT_MINDMAP_STORE_DIR: "/home/me/.agent-mindmap" },
    });
  });
});
