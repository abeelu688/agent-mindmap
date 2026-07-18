/**
 * Tests for `commandDownloadPackage`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exportSession: vi.fn(),
  openMindMapPackage: vi.fn(),
  showOpenDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  openExternal: vi.fn(),
  panel: {
    getMindMapData: vi.fn(),
  },
  readMindMapUiConfig: vi.fn(),
}));

vi.mock("@agent-mindmap/core", () => ({
  exportSession: mocks.exportSession,
}));

vi.mock("../../extension/src/export/openMindMapPackage", () => ({
  openMindMapPackage: mocks.openMindMapPackage,
}));

vi.mock("../../extension/src/ui/mindMapUiConfig", () => ({
  readMindMapUiConfig: mocks.readMindMapUiConfig,
}));

vi.mock("../../extension/src/webview/MindMapPanel", () => ({
  MindMapPanel: {
    getCurrent: vi.fn().mockReturnValue(mocks.panel),
  },
}));

vi.mock("../../extension/src/notify", () => ({
  notifyWarning: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("../../extension/src/adapters/coreUseCaseDeps", () => ({
  buildLogger: vi.fn().mockReturnValue({}),
}));

vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (_key: string, defaultMsg: string, ...args: unknown[]) => {
    if (args.length === 0) return defaultMsg;
    return defaultMsg.replace(/\{(\d+)\}/g, (_m, idx: string) => String(args[Number(idx)]));
  },
}));

vi.mock("vscode", () => ({
  Uri: {
    file: (p: string) => ({ fsPath: p }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join("/"),
    }),
  },
  env: {
    openExternal: mocks.openExternal,
  },
  window: {
    showOpenDialog: mocks.showOpenDialog,
    showInformationMessage: mocks.showInformationMessage,
  },
}));

import { commandDownloadPackage } from "../../extension/src/commands/downloadPackage";
import { notifyWarning, notifyError } from "../../extension/src/notify";

const fakeExtensionUri = { fsPath: "/tmp/ext" } as unknown as Parameters<
  typeof commandDownloadPackage
>[0];

describe("commandDownloadPackage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readMindMapUiConfig.mockReturnValue({});
    mocks.panel.getMindMapData.mockReturnValue({ children: [] });
    mocks.showOpenDialog.mockResolvedValue([{ fsPath: "/tmp/out" }]);
    mocks.exportSession.mockResolvedValue({
      outDir: "/tmp/out",
      transcriptCount: 2,
    });
    mocks.showInformationMessage.mockResolvedValue(undefined);
    mocks.openMindMapPackage.mockResolvedValue(undefined);
    mocks.openExternal.mockResolvedValue(true);
  });

  it("warns when no mind map is open", async () => {
    mocks.panel.getMindMapData.mockReturnValue(undefined);

    await commandDownloadPackage(fakeExtensionUri);

    expect(notifyWarning).toHaveBeenCalledWith(expect.stringContaining("Open a mind map first"));
    expect(mocks.showOpenDialog).not.toHaveBeenCalled();
  });

  it("aborts when user cancels folder selection", async () => {
    mocks.showOpenDialog.mockResolvedValue([]);

    await commandDownloadPackage(fakeExtensionUri);

    expect(mocks.exportSession).not.toHaveBeenCalled();
  });

  it("exports package with the picked folder and current mind map", async () => {
    await commandDownloadPackage(fakeExtensionUri);

    expect(mocks.exportSession).toHaveBeenCalledTimes(1);
    const exportOpts = mocks.exportSession.mock.calls[0]![0] as {
      mindMap: unknown;
      outDir: string;
      mediaDir: string;
    };
    expect(exportOpts.mindMap).toEqual({ children: [] });
    expect(exportOpts.outDir).toBe("/tmp/out");
    expect(exportOpts.mediaDir).toBe("/tmp/ext/media");
  });

  it("opens in browser when user picks openInBrowser", async () => {
    mocks.showInformationMessage.mockResolvedValue("Open in browser");

    await commandDownloadPackage(fakeExtensionUri);

    expect(mocks.openMindMapPackage).toHaveBeenCalledWith("/tmp/out");
  });

  it("reveals folder in file manager when user picks showInExplorer", async () => {
    mocks.showInformationMessage.mockResolvedValue("Show in file manager");

    await commandDownloadPackage(fakeExtensionUri);

    expect(mocks.openExternal).toHaveBeenCalledWith({ fsPath: "/tmp/out" });
  });

  it("notifies error when exportSession throws", async () => {
    mocks.exportSession.mockRejectedValue(new Error("disk full"));

    await commandDownloadPackage(fakeExtensionUri);

    expect(notifyError).toHaveBeenCalledWith(
      expect.stringContaining("Export failed"),
      expect.any(Error)
    );
  });

  it("does nothing when exportSession returns null", async () => {
    mocks.exportSession.mockResolvedValue(null);

    await commandDownloadPackage(fakeExtensionUri);

    expect(mocks.showInformationMessage).not.toHaveBeenCalled();
  });
});
