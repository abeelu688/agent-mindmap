/**
 * CLI command tests for `config get/set/list/path`.
 *
 * Unlike `team` or `mcp`, the config command defines its action handlers
 * inline via commander. We test by attaching the command to a parent
 * program with the global options declared, then parsing argv.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configSet: vi.fn(),
  configList: vi.fn(),
  configLoad: vi.fn(),
  userConfigFilePath: "/tmp/test-config.json",
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    constructor() {}
    get = mocks.configGet;
    set = mocks.configSet;
    list = mocks.configList;
    load = mocks.configLoad;
    storeDir = "/tmp/test-store";
    get userConfigFilePath() {
      return mocks.userConfigFilePath;
    }
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

import { configCommand } from "../../cli/src/commands/config";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
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
  program.addCommand(configCommand);
  return program;
}

describe("config get", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints the value when key is set", async () => {
    mocks.configGet.mockReturnValue("cursor-cli");

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "get", "llm.provider"]);

    expect(mocks.configGet).toHaveBeenCalledWith("llm.provider");
    expect(capturedLogs.some((l) => l.includes("cursor-cli"))).toBe(true);
  });

  it("prints (not set) when value is undefined", async () => {
    mocks.configGet.mockReturnValue(undefined);

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "get", "missing.key"]);

    expect(capturedLogs.some((l) => l.includes("(not set)"))).toBe(true);
  });
});

describe("config set", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.configSet.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("stores string value as-is when not parseable as JSON", async () => {
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "agent-mindmap",
      "config",
      "set",
      "llm.provider",
      "cursor-cli",
    ]);

    expect(mocks.configSet).toHaveBeenCalledWith("llm.provider", "cursor-cli");
    expect(capturedLogs.some((l) => l.includes("Set llm.provider"))).toBe(true);
  });

  it("parses JSON values when valid", async () => {
    const program = buildProgram();
    await program.parseAsync([
      "node",
      "agent-mindmap",
      "config",
      "set",
      "feature.flags",
      '{"enabled":true}',
    ]);

    expect(mocks.configSet).toHaveBeenCalledWith("feature.flags", { enabled: true });
  });

  it("parses numeric values", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "set", "limit", "42"]);

    expect(mocks.configSet).toHaveBeenCalledWith("limit", 42);
  });
});

describe("config list", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists all key/value pairs", async () => {
    mocks.configList.mockReturnValue({
      "llm.provider": "cursor-cli",
      "llm.model": "gpt-4",
    });

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "list"]);

    expect(capturedLogs.some((l) => l.includes("llm.provider"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("llm.model"))).toBe(true);
  });

  it("prints (no config set) when empty", async () => {
    mocks.configList.mockReturnValue({});

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "list"]);

    expect(capturedLogs.some((l) => l.includes("(no config set)"))).toBe(true);
  });
});

describe("config path", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints the user config file path", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "config", "path"]);

    expect(capturedLogs.some((l) => l.includes("/tmp/test-config.json"))).toBe(true);
  });
});
