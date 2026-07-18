/**
 * Tests for `commandSelectHost`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectHost: vi.fn(),
  resetHostCache: vi.fn(),
  getHostById: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  selectHost: mocks.selectHost,
}));

vi.mock("../../extension/src/host", () => ({
  resetHostCache: mocks.resetHostCache,
  getHostById: mocks.getHostById,
  WORKSPACE_HOST_KEY: "agentMindmap.host",
}));

vi.mock("../../extension/src/notify", () => ({
  notifyInfo: vi.fn(),
}));

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildPrompter: vi.fn().mockReturnValue({}),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (key: string, defaultMsg: string, ..._args: unknown[]) => defaultMsg,
}));

import { commandSelectHost } from "../../extension/src/commands/selectHost";
import { notifyInfo } from "../../extension/src/notify";

const fakeContext = {
  workspaceState: {
    get: vi.fn(),
    update: vi.fn(),
  },
} as unknown as Parameters<typeof commandSelectHost>[0];

describe("commandSelectHost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies and resets cache when a host is selected", async () => {
    mocks.selectHost.mockResolvedValue("cursor");
    mocks.getHostById.mockReturnValue({ displayName: "Cursor" });

    await commandSelectHost(fakeContext);

    expect(mocks.resetHostCache).toHaveBeenCalledTimes(1);
    expect(mocks.getHostById).toHaveBeenCalledWith("cursor");
    expect(notifyInfo).toHaveBeenCalledWith(
      expect.stringContaining("Host set to Cursor for this workspace")
    );
  });

  it("does nothing when user cancels selection", async () => {
    mocks.selectHost.mockResolvedValue(null);

    await commandSelectHost(fakeContext);

    expect(mocks.resetHostCache).not.toHaveBeenCalled();
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});
