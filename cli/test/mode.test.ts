/**
 * CLI command tests for `mode` (show or set project.mode).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configSet: vi.fn(),
  configLoad: vi.fn(),
  checkRepoPrerequisites: vi.fn(),
  normalizeRepoUriToSlug: vi.fn(),
  syncMcpConfigFiles: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  checkRepoPrerequisites: mocks.checkRepoPrerequisites,
  normalizeRepoUriToSlug: mocks.normalizeRepoUriToSlug,
}));

vi.mock("../../cli/src/adapters/mcpConfigSync", () => ({
  syncMcpConfigFiles: mocks.syncMcpConfigFiles,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    constructor() {}
    get = mocks.configGet;
    set = mocks.configSet;
    load = mocks.configLoad;
    storeDir = "/tmp/test-store";
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

import { modeCommand } from "../../cli/src/commands/mode";

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
  program.addCommand(modeCommand);
  return program;
}

describe("mode (show)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints the current mode when no argument given", async () => {
    mocks.configGet.mockReturnValue("workspace");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "mode"]);

    expect(mocks.configGet).toHaveBeenCalledWith("project.mode");
    expect(capturedLogs.some((l) => l.includes("Current mode: workspace"))).toBe(true);
  });

  it("reports repo slug when current mode is repo and prerequisites pass", async () => {
    mocks.configGet.mockReturnValue("repo");
    mocks.checkRepoPrerequisites.mockResolvedValue({
      ok: true,
      uri: "git@github.com:org/repo.git",
    });
    mocks.normalizeRepoUriToSlug.mockReturnValue("org/repo.git");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "mode"]);

    expect(capturedLogs.some((l) => l.includes("Current mode: repo"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Repo slug: org/repo.git"))).toBe(true);
  });

  it("warns when current mode is repo but prerequisites fail", async () => {
    mocks.configGet.mockReturnValue("repo");
    mocks.checkRepoPrerequisites.mockResolvedValue({ ok: false, reason: "no origin remote" });

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "mode"]);

    expect(capturedLogs.some((l) => l.includes("Repo prerequisites not met"))).toBe(true);
  });
});

describe("mode (set)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.configSet.mockResolvedValue(undefined);
    mocks.syncMcpConfigFiles.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("switches to workspace mode without prereq check", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "mode", "workspace"]);

    expect(mocks.configSet).toHaveBeenCalledWith("project.mode", "workspace");
    expect(mocks.syncMcpConfigFiles).toHaveBeenCalledTimes(1);
    expect(mocks.checkRepoPrerequisites).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Project mode set to: workspace"))).toBe(true);
  });

  it("switches to repo mode when prerequisites pass and shows slug", async () => {
    mocks.checkRepoPrerequisites.mockResolvedValue({
      ok: true,
      uri: "git@github.com:org/repo.git",
    });
    mocks.normalizeRepoUriToSlug.mockReturnValue("org/repo.git");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "mode", "repo"]);

    expect(mocks.configSet).toHaveBeenCalledWith("project.mode", "repo");
    expect(mocks.syncMcpConfigFiles).toHaveBeenCalledTimes(1);
    expect(capturedLogs.some((l) => l.includes("Project mode set to: repo"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Repo slug: org/repo.git"))).toBe(true);
  });

  it("aborts repo switch when prerequisites fail", async () => {
    mocks.checkRepoPrerequisites.mockResolvedValue({ ok: false, reason: "no origin remote" });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      buildProgram().parseAsync(["node", "agent-mindmap", "mode", "repo"])
    ).rejects.toThrow("exit");

    expect(mocks.configSet).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("Cannot switch to repo mode"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("rejects unknown mode values", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(
      buildProgram().parseAsync(["node", "agent-mindmap", "mode", "bogus"])
    ).rejects.toThrow("exit");

    expect(mocks.configSet).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes('Invalid mode "bogus"'))).toBe(true);
    exitSpy.mockRestore();
  });
});
