/**
 * CLI command tests for `host list/detect/select`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  selectHost: vi.fn(),
  createCursorHost: vi.fn(),
  createClaudeHost: vi.fn(),
  fsAccess: vi.fn(),
  configLoad: vi.fn(),
  configGet: vi.fn(),
  prompter: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock("@agent-mindmap/core", () => ({
  selectHost: mocks.selectHost,
  createCursorHost: mocks.createCursorHost,
  createClaudeHost: mocks.createClaudeHost,
}));

vi.mock("fs/promises", () => ({
  access: mocks.fsAccess,
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    storeDir = "/tmp/test-store";
    async load() {
      return mocks.configLoad();
    }
    get = mocks.configGet;
    set() {}
  },
  userConfigDir: () => "/tmp/agent-mindmap-test",
}));

vi.mock("../../cli/src/ui/prompter", () => ({
  buildCliPrompter: () => mocks.prompter,
}));

vi.mock("../../cli/src/ui/logger", () => ({
  log: (msg: string) => capturedLogs.push(String(msg)),
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

import { hostCommand } from "../../cli/src/commands/host";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program
    .option("--quiet")
    .option("--no-progress")
    .option("--no-color")
    .option("--verbose")
    .option("--cwd <path>")
    .option("--host <id>")
    .option("--workspace <slug>")
    .option("--locale <lang>")
    .option("--json")
    .option("--store-dir <path>");
  program.addCommand(hostCommand);
  return program;
}

describe("host list", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.createCursorHost.mockReturnValue({
      displayName: "Cursor",
      getSessionsScanDir: () => "/home/user/.cursor/sessions",
    });
    mocks.createClaudeHost.mockReturnValue({
      displayName: "Claude Code",
      getSessionsScanDir: () => "/home/user/.claude/projects",
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists cursor and claude-code hosts with their scan dirs", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "list"]);

    expect(capturedLogs.some((l) => l.includes("cursor (Cursor)"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("claude-code (Claude Code)"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("/home/user/.cursor/sessions"))).toBe(true);
  });

  it("prints (none) when scan dir is null", async () => {
    mocks.createCursorHost.mockReturnValue({
      displayName: "Cursor",
      getSessionsScanDir: () => null,
    });
    mocks.createClaudeHost.mockReturnValue({
      displayName: "Claude Code",
      getSessionsScanDir: () => null,
    });

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "list"]);

    expect(capturedLogs.some((l) => l.includes("Scan dir: (none)"))).toBe(true);
  });
});

describe("host detect", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.configGet.mockReturnValue("auto");
    mocks.createCursorHost.mockReturnValue({
      getSessionsScanDir: () => "/home/user/.cursor/sessions",
      encodeWorkspacePath: () => "slug",
    });
    mocks.createClaudeHost.mockReturnValue({
      getSessionsScanDir: () => "/home/user/.claude/projects",
      encodeWorkspacePath: () => "slug",
    });
    mocks.fsAccess.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints Resolved when host setting is explicit", async () => {
    mocks.configGet.mockReturnValue("cursor");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "detect"]);

    expect(capturedLogs.some((l) => l.includes("Host setting: cursor"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Resolved: cursor"))).toBe(true);
  });

  it("detects both hosts in auto mode when both scan dirs exist", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "detect"]);

    expect(capturedLogs.some((l) => l.includes("Detected: cursor, claude-code"))).toBe(true);
  });

  it("reports No hosts detected when scan dirs are missing", async () => {
    mocks.fsAccess.mockRejectedValue(new Error("ENOENT"));

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "detect"]);

    expect(capturedLogs.some((l) => l.includes("No hosts detected"))).toBe(true);
  });
});

describe("host select", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.configGet.mockReturnValue("auto");
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls selectHost and prints the chosen host", async () => {
    mocks.selectHost.mockResolvedValue("cursor");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "select"]);

    expect(mocks.selectHost).toHaveBeenCalledTimes(1);
    expect(capturedLogs.some((l) => l.includes("Host set to: cursor"))).toBe(true);
  });

  it("prints Cancelled when selectHost returns null", async () => {
    mocks.selectHost.mockResolvedValue(null);

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "host", "select"]);

    expect(capturedLogs.some((l) => l.includes("Cancelled"))).toBe(true);
  });
});
