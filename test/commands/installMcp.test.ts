/**
 * Tests for `commandInstallMcp`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  installMcp: vi.fn(),
  installMcpServerConfig: vi.fn(),
  showMcpInstallHint: vi.fn(),
  cursorMcpConfigPath: vi.fn(),
  claudeMcpConfigPath: vi.fn(),
  getWorkspacePath: vi.fn(),
  getStoreDir: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  installMcp: mocks.installMcp,
}));

vi.mock("../../extension/src/mcp/mcpConfig", () => ({
  installMcpServerConfig: mocks.installMcpServerConfig,
  showMcpInstallHint: mocks.showMcpInstallHint,
  cursorMcpConfigPath: mocks.cursorMcpConfigPath,
  claudeMcpConfigPath: mocks.claudeMcpConfigPath,
}));

vi.mock("../../extension/src/paths", () => ({
  getWorkspacePath: mocks.getWorkspacePath,
  getStoreDir: mocks.getStoreDir,
}));

vi.mock("../../extension/src/notify", () => ({
  notifyWarning: vi.fn(),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (_key: string, defaultMsg: string, ...args: unknown[]) => {
    if (args.length === 0) return defaultMsg;
    return defaultMsg.replace(/\{(\d+)\}/g, (_m, idx: string) => String(args[Number(idx)]));
  },
}));

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildPrompter: vi.fn().mockReturnValue({}),
  buildLogger: vi.fn().mockReturnValue({}),
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
      update: vi.fn().mockResolvedValue(undefined),
    }),
  },
  ConfigurationTarget: { Global: 1 },
}));

import { commandInstallMcp } from "../../extension/src/commands/installMcp";
import { notifyWarning } from "../../extension/src/notify";

const fakeContext = {
  extensionPath: "/tmp/ext",
} as unknown as Parameters<typeof commandInstallMcp>[0];

describe("commandInstallMcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspacePath.mockReturnValue("/home/user/project");
    mocks.getStoreDir.mockReturnValue("/tmp/store");
    mocks.cursorMcpConfigPath.mockReturnValue("/tmp/cursor/mcp.json");
    mocks.claudeMcpConfigPath.mockReturnValue("/tmp/claude/mcp.json");
    mocks.installMcpServerConfig.mockResolvedValue({
      cursorConfigPath: "/tmp/cursor/mcp.json",
      claudeConfigPath: undefined,
    });
    mocks.installMcp.mockImplementation(
      async (opts: {
        mcpInstaller: {
          installMcpServerConfig: (o: {
            workspaceRoot: string;
            storeDir: string;
            targets: string[];
          }) => Promise<unknown>;
          showInstallHint: (r: unknown) => void;
        };
        workspacePath: string;
        extensionPath: string;
        storeDir: string;
      }) => {
        const result = await opts.mcpInstaller.installMcpServerConfig({
          workspaceRoot: opts.workspacePath,
          storeDir: opts.storeDir,
          targets: [],
        });
        opts.mcpInstaller.showInstallHint(result);
      }
    );
  });

  it("warns when no workspace is open", async () => {
    mocks.getWorkspacePath.mockReturnValue(undefined);

    await commandInstallMcp(fakeContext);

    expect(notifyWarning).toHaveBeenCalledWith(expect.stringContaining("Open a workspace folder"));
    expect(mocks.installMcp).not.toHaveBeenCalled();
  });

  it("delegates to installMcp use case with workspace path and store dir", async () => {
    await commandInstallMcp(fakeContext);

    expect(mocks.installMcp).toHaveBeenCalledTimes(1);
    const callOpts = mocks.installMcp.mock.calls[0]![0] as {
      workspacePath: string;
      extensionPath: string;
      storeDir: string;
    };
    expect(callOpts.workspacePath).toBe("/home/user/project");
    expect(callOpts.extensionPath).toBe("/tmp/ext");
    expect(callOpts.storeDir).toBe("/tmp/store");
  });

  it("invokes installMcpServerConfig inside mcpInstaller with extensionPath", async () => {
    await commandInstallMcp(fakeContext);

    expect(mocks.installMcpServerConfig).toHaveBeenCalledWith(
      "/tmp/ext",
      "/home/user/project",
      "/tmp/store",
      []
    );
  });

  it("calls showInstallHint with installed flag based on config path presence", async () => {
    await commandInstallMcp(fakeContext);

    expect(mocks.showMcpInstallHint).toHaveBeenCalledTimes(1);
    const hintArg = mocks.showMcpInstallHint.mock.calls[0]![0] as {
      cursorConfigPath?: string;
      claudeConfigPath?: string;
    };
    expect(hintArg.cursorConfigPath).toBe("installed");
    expect(hintArg.claudeConfigPath).toBeUndefined();
  });
});
