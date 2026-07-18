/**
 * Tests for `commandSyncAiContext`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncAiContext: vi.fn(),
  refreshMcpIndexForWorkspace: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  syncAiContext: mocks.syncAiContext,
}));

vi.mock("../../extension/src/mcp/mcpConfig", () => ({
  refreshMcpIndexForWorkspace: mocks.refreshMcpIndexForWorkspace,
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

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildHostAccess: vi.fn().mockReturnValue({}),
  buildLogger: vi.fn().mockReturnValue({}),
}));

import { commandSyncAiContext } from "../../extension/src/commands/syncAiContext";
import { notifyInfo, notifyWarning } from "../../extension/src/notify";

describe("commandSyncAiContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("notifies success with project slug and record count", async () => {
    mocks.syncAiContext.mockResolvedValue({ projectSlug: "my-project", recordCount: 3 });

    await commandSyncAiContext();

    expect(mocks.syncAiContext).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("my-project"));
    expect(notifyInfo).toHaveBeenCalledWith(expect.stringContaining("3 session(s)"));
  });

  it("warns when no analyzed sessions exist", async () => {
    mocks.syncAiContext.mockResolvedValue(null);

    await commandSyncAiContext();

    expect(notifyWarning).toHaveBeenCalledTimes(1);
    expect(notifyWarning).toHaveBeenCalledWith(expect.stringContaining("No analyzed sessions"));
  });

  it("delegates to refreshMcpIndexForWorkspace inside mcpRefresher", async () => {
    mocks.syncAiContext.mockImplementation(
      async (opts: { mcpRefresher: { refreshMcpIndex: (slug: string) => Promise<unknown> } }) => {
        await opts.mcpRefresher.refreshMcpIndex("my-project");
        return { projectSlug: "my-project", recordCount: 1 };
      }
    );
    mocks.refreshMcpIndexForWorkspace.mockResolvedValue(undefined);

    await commandSyncAiContext();

    expect(mocks.refreshMcpIndexForWorkspace).toHaveBeenCalledTimes(1);
  });
});
