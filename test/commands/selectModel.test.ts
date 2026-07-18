/**
 * Tests for `commandSelectModel`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectModel: vi.fn(),
  readLlmOptions: vi.fn(),
  showCliInstallGuide: vi.fn(),
  showWarningMessage: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  selectModel: mocks.selectModel,
  CLI_SETTINGS_KEY: "agentMindmap.llm",
}));

vi.mock("../../extension/src/llmOptions", () => ({
  readLlmOptions: mocks.readLlmOptions,
}));

vi.mock("../../extension/src/llm/cliInstallGuideUi", () => ({
  showCliInstallGuide: mocks.showCliInstallGuide,
}));

vi.mock("../../extension/src/notify", () => ({
  notifyInfo: vi.fn(),
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
  window: {
    showWarningMessage: mocks.showWarningMessage,
  },
  commands: {
    executeCommand: mocks.executeCommand,
  },
  ConfigurationTarget: { Global: 1 },
}));

import { commandSelectModel } from "../../extension/src/commands/selectModel";
import { notifyInfo } from "../../extension/src/notify";

const fakeContext = {} as unknown as Parameters<typeof commandSelectModel>[0];

describe("commandSelectModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readLlmOptions.mockResolvedValue({ cliPath: "/usr/bin/cursor-agent" });
  });

  it("notifies when a model is selected", async () => {
    mocks.selectModel.mockImplementation(async (opts: { onNoCliFound?: () => Promise<void> }) => {
      // ensure onNoCliFound is not called when CLI is present
      expect(opts.onNoCliFound).toBeDefined();
      return { model: "claude-sonnet-4-6" };
    });

    await commandSelectModel(fakeContext);

    expect(notifyInfo).toHaveBeenCalledWith(
      expect.stringContaining("Model set to claude-sonnet-4-6")
    );
  });

  it("notifies with Default when model is empty string", async () => {
    mocks.selectModel.mockResolvedValue({ model: "" });

    await commandSelectModel(fakeContext);

    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("Default"));
  });

  it("does not notify when selectModel returns null", async () => {
    mocks.selectModel.mockResolvedValue(null);

    await commandSelectModel(fakeContext);

    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("invokes onNoCliFound when selectModel calls it", async () => {
    mocks.selectModel.mockImplementation(async (opts: { onNoCliFound: () => Promise<void> }) => {
      await opts.onNoCliFound();
      return null;
    });
    mocks.showWarningMessage.mockResolvedValue("Claude Code install guide");

    await commandSelectModel(fakeContext);

    expect(mocks.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(mocks.showCliInstallGuide).toHaveBeenCalledWith("claude-code", { modal: false });
  });

  it("opens settings when settings label is chosen", async () => {
    mocks.selectModel.mockImplementation(async (opts: { onNoCliFound: () => Promise<void> }) => {
      await opts.onNoCliFound();
      return null;
    });
    mocks.showWarningMessage.mockResolvedValue("Set CLI path in settings…");

    await commandSelectModel(fakeContext);

    expect(mocks.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "agentMindmap.llm"
    );
  });
});
