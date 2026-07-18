/**
 * CLI command tests for `version`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  CORE_PACKAGE_VERSION: "0.2.3",
  PIPELINE_VERSION: 7,
}));

vi.mock("@agent-mindmap/core", () => ({
  CORE_PACKAGE_VERSION: mocks.CORE_PACKAGE_VERSION,
  PIPELINE_VERSION: mocks.PIPELINE_VERSION,
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

import { versionCommand } from "../../cli/src/commands/version";

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
  program.addCommand(versionCommand);
  return program;
}

describe("version", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("prints CLI version, core version, pipeline version, and Node.js version", async () => {
    const program = buildProgram();
    await program.parseAsync(["node", "agent-mindmap", "version"]);

    expect(capturedLogs.some((l) => l.includes("Agent Mind Map CLI v"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("@agent-mindmap/core: v0.2.3"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("PIPELINE_VERSION:"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Node.js:"))).toBe(true);
  });
});
