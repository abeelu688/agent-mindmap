/**
 * CLI command tests for `model list/select`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  selectModel: vi.fn(),
  configLoad: vi.fn(),
  configGet: vi.fn(),
  prompter: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock("@agent-mindmap/core", () => ({
  selectModel: mocks.selectModel,
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

import { modelCommand } from "../../cli/src/commands/model";

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
  program.addCommand(modelCommand);
  return program;
}

describe("model list", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("lists available models with descriptions", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "model", "list"]);

    expect(capturedLogs.some((l) => l.includes("auto"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("claude-sonnet-4-6"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("claude-opus-4-8"))).toBe(true);
  });
});

describe("model select", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("calls selectModel and prints the chosen model", async () => {
    mocks.selectModel.mockResolvedValue({ model: "claude-sonnet-4-6" });

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "model", "select"]);

    expect(mocks.selectModel).toHaveBeenCalledTimes(1);
    expect(capturedLogs.some((l) => l.includes("Model set to: claude-sonnet-4-6"))).toBe(true);
  });

  it("prints auto when selected model is empty string", async () => {
    mocks.selectModel.mockResolvedValue({ model: "" });

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "model", "select"]);

    expect(capturedLogs.some((l) => l.includes("Model set to: auto"))).toBe(true);
  });

  it("prints Cancelled when selectModel returns null", async () => {
    mocks.selectModel.mockResolvedValue(null);

    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "model", "select"]);

    expect(capturedLogs.some((l) => l.includes("Cancelled"))).toBe(true);
  });
});
