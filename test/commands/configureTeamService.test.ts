/**
 * Tests for `commandConfigureTeamService`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTeamServerUrl: vi.fn(),
  setTeamApiKey: vi.fn(),
  resetTeamStoreCache: vi.fn(),
  showInputBox: vi.fn(),
  configUpdate: vi.fn(),
}));

vi.mock("../../extension/src/store/storeFactory", () => ({
  getTeamServerUrl: mocks.getTeamServerUrl,
  setTeamApiKey: mocks.setTeamApiKey,
}));

vi.mock("../../extension/src/store/storeClient", () => ({
  resetTeamStoreCache: mocks.resetTeamStoreCache,
}));

vi.mock("../../extension/src/notify", () => ({
  notifyInfo: vi.fn(),
  notifyWarning: vi.fn(),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (_key: string, defaultMsg: string, ...args: unknown[]) => {
    if (args.length === 0) return defaultMsg;
    return defaultMsg.replace(/\{(\d+)\}/g, (_m, idx: string) => String(args[Number(idx)]));
  },
}));

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      update: mocks.configUpdate,
    }),
  },
  window: {
    showInputBox: mocks.showInputBox,
  },
  ConfigurationTarget: { Global: 1 },
}));

import { commandConfigureTeamService } from "../../extension/src/commands/configureTeamService";
import { notifyInfo, notifyWarning } from "../../extension/src/notify";

const fakeContext = {} as unknown as Parameters<typeof commandConfigureTeamService>[0];

describe("commandConfigureTeamService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTeamServerUrl.mockReturnValue("");
    mocks.configUpdate.mockResolvedValue(undefined);
    mocks.setTeamApiKey.mockResolvedValue(undefined);
  });

  it("aborts when user cancels the URL prompt", async () => {
    mocks.showInputBox.mockResolvedValue(undefined);

    await commandConfigureTeamService(fakeContext);

    expect(mocks.configUpdate).not.toHaveBeenCalled();
    expect(mocks.setTeamApiKey).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it("disables team mode when URL is empty", async () => {
    mocks.showInputBox.mockResolvedValueOnce("   ");

    await commandConfigureTeamService(fakeContext);

    expect(mocks.configUpdate).toHaveBeenCalledWith("team.serverUrl", "", 1);
    expect(mocks.setTeamApiKey).toHaveBeenCalledWith(fakeContext, "");
    expect(mocks.resetTeamStoreCache).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("Team service disabled"));
  });

  it("aborts when user cancels the API key prompt", async () => {
    mocks.showInputBox.mockResolvedValueOnce("https://team.example.com");
    mocks.showInputBox.mockResolvedValueOnce(undefined);

    await commandConfigureTeamService(fakeContext);

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      "team.serverUrl",
      "https://team.example.com",
      1
    );
    expect(mocks.setTeamApiKey).not.toHaveBeenCalled();
  });

  it("warns when API key is empty", async () => {
    mocks.showInputBox.mockResolvedValueOnce("https://team.example.com");
    mocks.showInputBox.mockResolvedValueOnce("");

    await commandConfigureTeamService(fakeContext);

    expect(notifyWarning).toHaveBeenCalledWith(expect.stringContaining("empty-api-key"));
    expect(mocks.setTeamApiKey).not.toHaveBeenCalled();
  });

  it("applies URL and key when both are provided", async () => {
    mocks.showInputBox.mockResolvedValueOnce("https://team.example.com");
    mocks.showInputBox.mockResolvedValueOnce("secret-token");

    await commandConfigureTeamService(fakeContext);

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      "team.serverUrl",
      "https://team.example.com",
      1
    );
    expect(mocks.setTeamApiKey).toHaveBeenCalledWith(fakeContext, "secret-token");
    expect(mocks.resetTeamStoreCache).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("Team service configured"));
  });

  it("trims whitespace from URL and key", async () => {
    mocks.showInputBox.mockResolvedValueOnce("  https://team.example.com  ");
    mocks.showInputBox.mockResolvedValueOnce("  secret-token  ");

    await commandConfigureTeamService(fakeContext);

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      "team.serverUrl",
      "https://team.example.com",
      1
    );
    expect(mocks.setTeamApiKey).toHaveBeenCalledWith(fakeContext, "secret-token");
  });
});
