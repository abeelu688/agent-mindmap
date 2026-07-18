/**
 * CLI command tests for `doctor` diagnostics.
 *
 * The doctor command is registered as a commander action (no exported
 * handler), so we attach it to a parent program and parse argv.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  createCursorHost: vi.fn(),
  createClaudeHost: vi.fn(),
  fsAccess: vi.fn(),
  exec: vi.fn(),
  configLoad: vi.fn(),
  configGet: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  createCursorHost: mocks.createCursorHost,
  createClaudeHost: mocks.createClaudeHost,
  CORE_PACKAGE_VERSION: "0.2.3",
}));

vi.mock("fs/promises", () => ({
  access: mocks.fsAccess,
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("child_process", () => ({
  exec: mocks.exec,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    storeDir = "/tmp/test-store";
    userConfigFilePath = "/tmp/test-config.json";
    async load() {
      return mocks.configLoad();
    }
    get = mocks.configGet;
    set() {}
  },
  userConfigDir: () => "/tmp/agent-mindmap-test",
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

import { doctorCommand } from "../../cli/src/commands/doctor";

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
  program.addCommand(doctorCommand);
  return program;
}

describe("doctor", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.configGet.mockReturnValue(undefined);
    mocks.createCursorHost.mockReturnValue({
      getSessionsScanDir: () => "/home/user/.cursor/sessions",
      encodeWorkspacePath: () => "encoded-cursor-slug",
    });
    mocks.createClaudeHost.mockReturnValue({
      getSessionsScanDir: () => "/home/user/.claude/projects",
      encodeWorkspacePath: () => "encoded-claude-slug",
    });
    mocks.fsAccess.mockResolvedValue(undefined);
    mocks.exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null) => void) =>
      cb(null)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints version and store info when at least one scan dir is found", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "doctor"]);

    expect(capturedLogs.some((l) => l.includes("Agent Mind Map CLI v"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("@agent-mindmap/core: v"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Store:"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Hosts:"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("cursor:"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("claude-code:"))).toBe(true);
  });

  it("exits with code 1 when no scan dirs are found", async () => {
    mocks.createCursorHost.mockReturnValue({
      getSessionsScanDir: () => null,
      encodeWorkspacePath: () => "slug",
    });
    mocks.createClaudeHost.mockReturnValue({
      getSessionsScanDir: () => null,
      encodeWorkspacePath: () => "slug",
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    const program = buildProgram();
    await expect(program.parseAsync(["node", "agent-mindmap", "doctor"])).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("No agent transcript directories found"))).toBe(
      true
    );
    exitSpy.mockRestore();
  });

  it("warns when store directory does not exist", async () => {
    mocks.fsAccess.mockRejectedValue(new Error("ENOENT"));

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "doctor"]);

    expect(capturedLogs.some((l) => l.includes("Store directory not found"))).toBe(true);
  });

  it("marks CLI as not found when exec fails", async () => {
    mocks.exec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error | null) => void) =>
      cb(new Error("ENOENT"))
    );

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "doctor"]);

    expect(capturedLogs.some((l) => l.includes("CLI: not found"))).toBe(true);
  });
});
