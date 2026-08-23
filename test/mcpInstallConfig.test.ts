import { describe, expect, it } from "vitest";
import {
  claudeMcpConfigPath,
  claudeMcpConfigPathGlobal,
  cursorMcpConfigPath,
  cursorMcpConfigPathGlobal,
  mergeAgentMindmapIntoConfig,
  resolveClaudeMcpConfigPath,
  resolveCursorMcpConfigPath,
  type McpServersConfig,
} from "@agent-mindmap/core";

describe("mcp install config paths", () => {
  it("resolves project-scoped Cursor and Claude Code config paths", () => {
    const root = "/home/example/proj";
    expect(cursorMcpConfigPath(root)).toBe("/home/example/proj/.cursor/mcp.json");
    expect(claudeMcpConfigPath(root)).toBe("/home/example/proj/.mcp.json");
  });

  it("resolves global (user-scope) config paths at the home dir", () => {
    // Cursor global mirrors the project layout under ~; Claude Code global is
    // ~/.claude.json (NOT ~/.mcp.json).
    expect(cursorMcpConfigPathGlobal()).toMatch(/\.cursor[\\/]mcp\.json$/);
    expect(claudeMcpConfigPathGlobal()).toMatch(/\.claude\.json$/);
  });

  it("resolveXxxMcpConfigPath picks the path by scope", () => {
    const root = "/home/example/proj";
    expect(resolveCursorMcpConfigPath("project", root)).toBe("/home/example/proj/.cursor/mcp.json");
    expect(resolveCursorMcpConfigPath("user", root)).toBe(cursorMcpConfigPathGlobal());
    expect(resolveClaudeMcpConfigPath("project", root)).toBe("/home/example/proj/.mcp.json");
    expect(resolveClaudeMcpConfigPath("user", root)).toBe(claudeMcpConfigPathGlobal());
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

  it("preserves other top-level fields (safe for ~/.claude.json)", () => {
    const existing = {
      mcpServers: { other: { command: "echo" } },
      history: ["a", "b"],
      numStartups: 42,
    } as unknown as McpServersConfig;
    const merged = mergeAgentMindmapIntoConfig(existing, "/tmp/server.js", "/store");
    expect((merged as Record<string, unknown>).history).toEqual(["a", "b"]);
    expect((merged as Record<string, unknown>).numStartups).toBe(42);
    expect(merged.mcpServers?.["agent-mindmap"]).toBeDefined();
  });
});
