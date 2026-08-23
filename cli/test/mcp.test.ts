/**
 * CLI command tests for `mcp install`, `mcp uninstall`, and `mcp status`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  resolveCursorMcpConfigPath: vi.fn(),
  resolveClaudeMcpConfigPath: vi.fn(),
  mergeAgentMindmapIntoConfig: vi.fn(),
  writeJsonAtomic: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  fsMkdir: vi.fn(),
  prompter: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  readFile: mocks.fsReadFile,
  writeFile: mocks.fsWriteFile,
  mkdir: mocks.fsMkdir,
  access: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  resolveCursorMcpConfigPath: mocks.resolveCursorMcpConfigPath,
  resolveClaudeMcpConfigPath: mocks.resolveClaudeMcpConfigPath,
  mergeAgentMindmapIntoConfig: mocks.mergeAgentMindmapIntoConfig,
  writeJsonAtomic: mocks.writeJsonAtomic,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    storeDir = "/tmp/test-store";
    async load() {}
    get() {
      return undefined;
    }
    set() {}
  },
  userConfigDir: () => "/tmp/agent-mindmap-test",
}));

vi.mock("../../cli/src/ui/prompter", () => ({
  buildCliPrompter: () => mocks.prompter,
}));

vi.mock("../../cli/src/ui/logger", () => ({
  log: (msg: string) => capturedLogs.push(msg),
  logSuccess: (msg: string) => capturedLogs.push(`✓ ${msg}`),
  logError: (msg: string) => capturedLogs.push(`✗ ${msg}`),
  logWarn: (msg: string) => capturedLogs.push(`⚠ ${msg}`),
  logInfo: (msg: string) => capturedLogs.push(msg),
  logDebug: () => {},
  isJsonMode: () => false,
  isQuiet: () => false,
  isVerbose: () => false,
  useColor: () => false,
  useProgress: () => false,
  printJson: (data: unknown) => capturedLogs.push(JSON.stringify(data)),
  createSpinner: () => ({
    start: () => {},
    succeed: (msg?: string) => msg && capturedLogs.push(`✓ ${msg}`),
    fail: (msg?: string) => msg && capturedLogs.push(`✗ ${msg}`),
    warn: (msg?: string) => msg && capturedLogs.push(`⚠ ${msg}`),
    text: "",
  }),
  applyGlobalFlags: () => {},
  setJsonMode: () => {},
  buildCliLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import { runMcpInstall, runMcpUninstall, runMcpStatus } from "../../cli/src/commands/mcp";

const CURSOR_PROJECT = "/tmp/cursor/mcp.json";
const CURSOR_USER = "/tmp/home/.cursor/mcp.json";
const CLAUDE_PROJECT = "/tmp/claude/mcp.json";
const CLAUDE_USER = "/tmp/home/.claude.json";

function mockResolvePaths(): void {
  mocks.resolveCursorMcpConfigPath.mockImplementation((scope: string) =>
    scope === "user" ? CURSOR_USER : CURSOR_PROJECT
  );
  mocks.resolveClaudeMcpConfigPath.mockImplementation((scope: string) =>
    scope === "user" ? CLAUDE_USER : CLAUDE_PROJECT
  );
}

describe("mcp install", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mockResolvePaths();
    mocks.mergeAgentMindmapIntoConfig.mockReturnValue({
      mcpServers: { "agent-mindmap": { command: "node", args: ["/tmp/server.js"] } },
    });
    mocks.writeJsonAtomic.mockResolvedValue(undefined);
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    mocks.fsWriteFile.mockResolvedValue(undefined);
    mocks.fsMkdir.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("installs Cursor config when --targets cursor (project scope)", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", { targets: "cursor" });

    expect(mocks.resolveCursorMcpConfigPath).toHaveBeenCalledWith("project", "/home/user/project");
    expect(mocks.fsWriteFile).toHaveBeenCalledWith(
      CURSOR_PROJECT,
      expect.stringContaining("agent-mindmap")
    );
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Cursor MCP config updated"))).toBe(true);
  });

  it("installs Claude Code config when --targets claude-code (project scope)", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", { targets: "claude-code" });

    expect(mocks.resolveClaudeMcpConfigPath).toHaveBeenCalledWith("project", "/home/user/project");
    expect(mocks.fsWriteFile).toHaveBeenCalledWith(
      CLAUDE_PROJECT,
      expect.stringContaining("agent-mindmap")
    );
    expect(capturedLogs.some((l) => l.includes("Claude Code MCP config updated"))).toBe(true);
  });

  it("installs both when --targets cursor,claude-code", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", {
      targets: "cursor,claude-code",
    });

    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(2);
  });

  it("writes global config via atomic write when --scope user", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", {
      targets: "claude-code",
      scope: "user",
    });

    expect(mocks.resolveClaudeMcpConfigPath).toHaveBeenCalledWith("user", "/home/user/project");
    expect(mocks.writeJsonAtomic).toHaveBeenCalledWith(
      CLAUDE_USER,
      expect.objectContaining({ mcpServers: expect.any(Object) })
    );
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Global config written"))).toBe(true);
  });

  it("warns on invalid --scope", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", {
      targets: "cursor",
      scope: "bogus",
    });

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(mocks.writeJsonAtomic).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Invalid --scope"))).toBe(true);
  });

  it("warns when no targets selected via --targets flag", async () => {
    await runMcpInstall("/home/user/project", "/tmp/store", { targets: "" });

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("No targets selected"))).toBe(true);
  });

  it("uses prompter in interactive mode when targets omitted", async () => {
    mocks.prompter.showQuickPick.mockResolvedValue([
      { label: "Cursor", target: "cursor" },
      { label: "Claude Code", target: "claude" },
    ]);

    await runMcpInstall("/home/user/project", "/tmp/store", {});

    expect(mocks.prompter.showQuickPick).toHaveBeenCalledTimes(1);
    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(2);
  });

  it("aborts when prompter returns empty selection", async () => {
    mocks.prompter.showQuickPick.mockResolvedValue([]);

    await runMcpInstall("/home/user/project", "/tmp/store", {});

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("No targets selected"))).toBe(true);
  });
});

describe("mcp uninstall", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mockResolvePaths();
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          "agent-mindmap": { command: "node" },
          "other-tool": { command: "other" },
        },
      })
    );
    mocks.fsWriteFile.mockResolvedValue(undefined);
    mocks.fsMkdir.mockResolvedValue(undefined);
    mocks.writeJsonAtomic.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes agent-mindmap from Cursor config when present (project)", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          "agent-mindmap": { command: "node" },
          "other-tool": { command: "other" },
        },
      })
    );

    await runMcpUninstall("/home/user/project", undefined, { targets: "cursor" });

    expect(mocks.fsWriteFile).toHaveBeenCalledWith(
      CURSOR_PROJECT,
      expect.not.stringContaining("agent-mindmap")
    );
    expect(capturedLogs.some((l) => l.includes("Removed agent-mindmap from Cursor"))).toBe(true);
  });

  it("removes agent-mindmap from global Claude config when --scope user", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          "agent-mindmap": { command: "node" },
          "other-tool": { command: "other" },
        },
      })
    );

    await runMcpUninstall("/home/user/project", undefined, {
      targets: "claude-code",
      scope: "user",
    });

    expect(mocks.resolveClaudeMcpConfigPath).toHaveBeenCalledWith("user", "/home/user/project");
    expect(mocks.writeJsonAtomic).toHaveBeenCalledWith(
      CLAUDE_USER,
      expect.objectContaining({ mcpServers: expect.any(Object) })
    );
    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
  });

  it("warns when Cursor config has no agent-mindmap entry", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({ mcpServers: { "other-tool": { command: "other" } } })
    );

    await runMcpUninstall("/home/user/project", undefined, { targets: "cursor" });

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("No agent-mindmap entry in Cursor"))).toBe(true);
  });

  it("uninstalls both targets by default when --targets omitted", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({
        mcpServers: {
          "agent-mindmap": { command: "node" },
          "other-tool": { command: "other" },
        },
      })
    );

    await runMcpUninstall("/home/user/project", undefined, {});

    expect(mocks.fsWriteFile).toHaveBeenCalledTimes(2);
  });

  it("deletes mcpServers key when agent-mindmap was the only entry", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({ mcpServers: { "agent-mindmap": { command: "node" } } })
    );

    await runMcpUninstall("/home/user/project", undefined, { targets: "cursor" });

    const writtenArg = mocks.fsWriteFile.mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenArg);
    expect(parsed.mcpServers).toBeUndefined();
  });
});

describe("mcp status", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mockResolvePaths();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports installed state when configs have agent-mindmap", async () => {
    mocks.fsReadFile.mockResolvedValue(
      JSON.stringify({ mcpServers: { "agent-mindmap": { command: "node" } } })
    );

    await runMcpStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("Cursor (project)"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("✓ installed"))).toBe(true);
  });

  it("reports not installed when config is missing", async () => {
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));

    await runMcpStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("✗ not installed"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Run `agent-mindmap mcp install`"))).toBe(true);
  });
});
