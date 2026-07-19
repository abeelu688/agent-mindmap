/**
 * CLI command tests for `context sync`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  syncAiContext: vi.fn(),
  syncMcpConfigFiles: vi.fn(),
  buildCliHostAccess: vi.fn(),
  buildCliStoreAccess: vi.fn(),
  configLoad: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  syncAiContext: mocks.syncAiContext,
}));

vi.mock("../../cli/src/adapters/mcpConfigSync", () => ({
  syncMcpConfigFiles: mocks.syncMcpConfigFiles,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    storeDir = "/tmp/test-store";
    async load() {
      return mocks.configLoad();
    }
    get() {
      return undefined;
    }
    set() {}
  },
  userConfigDir: () => "/tmp/agent-mindmap-test",
}));

vi.mock("../../cli/src/adapters/analyzeDeps", () => ({
  buildCliHostAccess: mocks.buildCliHostAccess,
}));

vi.mock("../../cli/src/adapters/cliStore", () => ({
  buildCliStoreAccess: mocks.buildCliStoreAccess,
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

import { runContextSync } from "../../cli/src/commands/context";

describe("context sync", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.configLoad.mockResolvedValue(undefined);
    mocks.syncMcpConfigFiles.mockResolvedValue(undefined);
    mocks.buildCliHostAccess.mockReturnValue({
      getActiveHost: vi.fn(),
      getWorkspacePath: vi.fn().mockReturnValue("/home/user/project"),
      getWorkspaceSlug: vi.fn().mockReturnValue("my-project"),
    });
    mocks.buildCliStoreAccess.mockReturnValue({
      getStore: vi.fn().mockResolvedValue({
        listRecordsForProject: vi.fn().mockResolvedValue([]),
      }),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it("logs success and reports records when sync returns a result", async () => {
    mocks.syncAiContext.mockResolvedValue({
      projectSlug: "my-project",
      recordCount: 3,
    });

    await runContextSync("/home/user/project", undefined);

    expect(mocks.syncAiContext).toHaveBeenCalledTimes(1);
    expect(capturedLogs.some((l) => l.includes("Context sync complete"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Project: my-project"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Records: 3"))).toBe(true);
  });

  it("warns when sync returns null (no analyzed sessions)", async () => {
    mocks.syncAiContext.mockResolvedValue(null);

    await runContextSync("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("No analyzed sessions"))).toBe(true);
  });

  it("exits with code 1 when sync throws", async () => {
    mocks.syncAiContext.mockRejectedValue(new Error("sync failed"));
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runContextSync("/home/user/project", undefined)).rejects.toThrow("exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("sync failed"))).toBe(true);
    exitSpy.mockRestore();
  });
});
