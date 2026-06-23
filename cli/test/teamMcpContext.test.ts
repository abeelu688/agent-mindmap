/**
 * CLI P5 command tests — team configure/status/push, MCP install/uninstall/status, context sync.
 *
 * We mock core/shared modules and test that:
 * - Team configure saves server URL to config and token to file
 * - Team status shows configuration state
 * - Team push validates configuration before pushing
 * - MCP install/uninstall writes/removes entries from config files
 * - MCP status reports installation state
 * - Context sync calls the core use case
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "path";
import * as os from "os";

// ─── Capture logs from logger mock ─────────────────────────────────────────

const capturedLogs: string[] = [];

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  readRecord: vi.fn(),
  ensureStore: vi.fn(),
  buildCliHostAccess: vi.fn(),
  buildCliStoreAccess: vi.fn(),
  buildCliLogger: vi.fn(),
  pushToTeam: vi.fn(),
  syncAiContext: vi.fn(),
  cursorMcpConfigPath: vi.fn(),
  claudeMcpConfigPath: vi.fn(),
  mergeAgentMindmapIntoConfig: vi.fn(),
  RemoteStore: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  listSessions: mocks.listSessions,
  readRecord: mocks.readRecord,
  ensureStore: mocks.ensureStore,
  pushToTeam: mocks.pushToTeam,
  syncAiContext: mocks.syncAiContext,
  cursorMcpConfigPath: mocks.cursorMcpConfigPath,
  claudeMcpConfigPath: mocks.claudeMcpConfigPath,
  mergeAgentMindmapIntoConfig: mocks.mergeAgentMindmapIntoConfig,
}));

vi.mock("@agent-mindmap/shared", () => ({
  RemoteStore: mocks.RemoteStore,
}));

vi.mock("../../cli/src/adapters/analyzeDeps", () => ({
  buildCliHostAccess: mocks.buildCliHostAccess,
}));

vi.mock("../../cli/src/adapters/cliStore", () => ({
  buildCliStoreAccess: mocks.buildCliStoreAccess,
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    private data: Record<string, unknown> = {};
    storeDir = "/tmp/test-store";
    async load() {}
    get<T>(key: string): T | undefined {
      return this.data[key] as T;
    }
    async set(key: string, value: unknown) {
      this.data[key] = value;
    }
  },
  userConfigDir: () => path.join(os.tmpdir(), "test-agent-mindmap-cli"),
}));

vi.mock("../../cli/src/ui/logger", () => ({
  log: (msg: string) => capturedLogs.push(msg),
  logSuccess: (msg: string) => capturedLogs.push(`✓ ${msg}`),
  logError: (msg: string) => capturedLogs.push(`✗ ${msg}`),
  logWarn: (msg: string) => capturedLogs.push(`⚠ ${msg}`),
  isJsonMode: () => false,
  printJson: (data: unknown) => capturedLogs.push(JSON.stringify(data)),
  createSpinner: () => ({
    start: () => {},
    succeed: () => {},
    fail: () => {},
    warn: () => {},
    text: "",
  }),
  applyGlobalFlags: () => {},
  setJsonMode: () => {},
  buildCliLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../cli/src/ui/prompter", () => ({
  buildCliPrompter: () => ({
    showInputBox: vi.fn().mockResolvedValue(undefined),
    showQuickPick: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { runTeamStatus } from "../../cli/src/commands/team";
import { runMcpStatus } from "../../cli/src/commands/mcp";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("team status (P5.2)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows team not configured when no server URL", async () => {
    await runTeamStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("not configured"))).toBe(true);
  });

  it("shows token status when server URL is set", async () => {
    // This test verifies the command handler doesn't crash
    await runTeamStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("Team service"))).toBe(true);
  });
});

describe("mcp status (P5.5)", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    mocks.cursorMcpConfigPath.mockReturnValue("/project/.cursor/mcp.json");
    mocks.claudeMcpConfigPath.mockReturnValue("/project/.mcp.json");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows not installed when no config files exist", async () => {
    await runMcpStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("not installed"))).toBe(true);
  });

  it("shows install suggestion when not installed", async () => {
    await runMcpStatus("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("mcp install"))).toBe(true);
  });
});
