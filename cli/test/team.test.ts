/**
 * CLI command tests for `team configure` and `team push`.
 *
 * `team status` is covered in teamMcpContext.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const capturedLogs: string[] = [];

const mocks = vi.hoisted(() => ({
  config: {
    get: vi.fn(),
    set: vi.fn(),
    load: vi.fn(),
  },
  prompter: {
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
  fetch: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
  fsMkdir: vi.fn(),
  pushToTeam: vi.fn(),
  remoteStoreCtor: vi.fn(),
  pushQueueCtor: vi.fn(),
  buildCliStoreAccess: vi.fn(),
  listAllRecords: vi.fn(),
}));

const mockStore = { listAllRecords: mocks.listAllRecords };

vi.mock("fs/promises", () => ({
  readFile: mocks.fsReadFile,
  writeFile: mocks.fsWriteFile,
  mkdir: mocks.fsMkdir,
  access: vi.fn(),
}));

vi.mock("../../cli/src/config/configStore", () => ({
  CliConfigStore: class {
    constructor() {}
    get = mocks.config.get;
    set = mocks.config.set;
    load = mocks.config.load;
    storeDir = "/tmp/test-store";
    userConfigFilePath = "/tmp/test-config.json";
  },
  userConfigDir: () => "/tmp/agent-mindmap-test",
}));

vi.mock("../../cli/src/ui/prompter", () => ({
  buildCliPrompter: () => mocks.prompter,
}));

vi.mock("../../cli/src/ui/logger", () => ({
  log: (msg: string) => capturedLogs.push(msg),
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

vi.mock("@agent-mindmap/core", () => ({
  pushToTeam: mocks.pushToTeam,
  PushQueue: mocks.pushQueueCtor,
}));

vi.mock("@agent-mindmap/shared", () => ({
  RemoteStore: mocks.remoteStoreCtor,
}));

vi.mock("../../cli/src/adapters/cliStore", () => ({
  buildCliStoreAccess: mocks.buildCliStoreAccess,
}));

import { runTeamConfigure, runTeamPush } from "../../cli/src/commands/team";

describe("team configure", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.config.load.mockResolvedValue(undefined);
    mocks.config.set.mockResolvedValue(undefined);
    mocks.config.get.mockReturnValue("");
    mocks.fetch.mockReset();
    (globalThis as { fetch?: unknown }).fetch = mocks.fetch as unknown as typeof fetch;
    // Default: no token file exists
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    mocks.fsWriteFile.mockResolvedValue(undefined);
    mocks.fsMkdir.mockResolvedValue(undefined);
    delete process.env.AGENT_MINDMAP_TEAM_TOKEN;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_MINDMAP_TEAM_TOKEN;
  });

  it("saves URL and token when server healthcheck passes", async () => {
    mocks.prompter.showInputBox
      .mockResolvedValueOnce("https://team.example.com")
      .mockResolvedValueOnce("secret-token");
    mocks.fetch.mockResolvedValue({ ok: true });

    await runTeamConfigure("/home/user/project", undefined);

    expect(mocks.config.set).toHaveBeenCalledWith("team.serverUrl", "https://team.example.com");
    expect(mocks.fsWriteFile).toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Token saved"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Team service configured"))).toBe(true);
  });

  it("aborts when server healthcheck fails", async () => {
    mocks.prompter.showInputBox.mockResolvedValueOnce("https://bad.example.com");
    mocks.fetch.mockResolvedValue({ ok: false, status: 500 });

    await runTeamConfigure("/home/user/project", undefined);

    expect(mocks.config.set).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Server returned 500"))).toBe(true);
    expect(capturedLogs.some((l) => l.includes("Could not reach"))).toBe(true);
  });

  it("aborts when fetch throws on bad URL", async () => {
    mocks.prompter.showInputBox.mockResolvedValueOnce("not-a-url");
    mocks.fetch.mockRejectedValue(new Error("ENOTFOUND"));

    await runTeamConfigure("/home/user/project", undefined);

    expect(mocks.config.set).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Connection failed"))).toBe(true);
  });

  it("cancels when URL prompt returns empty", async () => {
    mocks.prompter.showInputBox.mockResolvedValueOnce("");

    await runTeamConfigure("/home/user/project", undefined);

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.config.set).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("Cancelled"))).toBe(true);
  });

  it("keeps existing token when prompt returns the mask placeholder", async () => {
    mocks.config.get.mockReturnValue("https://team.example.com");
    mocks.fsReadFile.mockResolvedValue("existing-token");
    mocks.prompter.showInputBox
      .mockResolvedValueOnce("https://team.example.com")
      .mockResolvedValueOnce("••••••••");
    mocks.fetch.mockResolvedValue({ ok: true });

    await runTeamConfigure("/home/user/project", undefined);

    expect(mocks.fsWriteFile).not.toHaveBeenCalled();
    expect(capturedLogs.some((l) => l.includes("unchanged"))).toBe(true);
  });
});

describe("team push", () => {
  beforeEach(() => {
    capturedLogs.length = 0;
    vi.clearAllMocks();
    mocks.config.load.mockResolvedValue(undefined);
    mocks.config.set.mockResolvedValue(undefined);
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));
    mocks.buildCliStoreAccess.mockReturnValue({
      getStore: vi.fn().mockResolvedValue(mockStore),
    });
    mocks.remoteStoreCtor.mockImplementation(() => ({}));
    mocks.pushQueueCtor.mockImplementation(() => ({
      drain: vi.fn().mockResolvedValue(undefined),
      dispose: () => {},
    }));
    mocks.listAllRecords.mockResolvedValue([]);
    mocks.pushToTeam.mockResolvedValue(undefined);
    delete process.env.AGENT_MINDMAP_TEAM_TOKEN;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.AGENT_MINDMAP_TEAM_TOKEN;
  });

  it("exits with code 1 when server URL is not configured", async () => {
    mocks.config.get.mockReturnValue("");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runTeamPush("/home/user/project", undefined)).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("not configured"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("exits with code 1 when API key is missing", async () => {
    mocks.config.get.mockReturnValue("https://team.example.com");
    mocks.fsReadFile.mockRejectedValue(new Error("ENOENT"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runTeamPush("/home/user/project", undefined)).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("API key is missing"))).toBe(true);
    exitSpy.mockRestore();
  });

  it("reports no sessions when local store is empty", async () => {
    mocks.config.get.mockReturnValue("https://team.example.com");
    process.env.AGENT_MINDMAP_TEAM_TOKEN = "test-token";
    mocks.listAllRecords.mockResolvedValue([]);

    await runTeamPush("/home/user/project", undefined);

    expect(capturedLogs.some((l) => l.includes("No local sessions to push"))).toBe(true);
    expect(mocks.pushToTeam).not.toHaveBeenCalled();
  });

  it("calls pushToTeam use case when records exist", async () => {
    mocks.config.get.mockReturnValue("https://team.example.com");
    process.env.AGENT_MINDMAP_TEAM_TOKEN = "test-token";
    mocks.listAllRecords.mockResolvedValue([{ meta: { projectSlug: "proj-a", analyzedAt: 1 } }]);

    await runTeamPush("/home/user/project", undefined);

    expect(mocks.pushToTeam).toHaveBeenCalledTimes(1);
    expect(capturedLogs.some((l) => l.includes("Pushed 1 session(s)"))).toBe(true);
  });

  it("exits with code 1 when pushToTeam throws", async () => {
    mocks.config.get.mockReturnValue("https://team.example.com");
    process.env.AGENT_MINDMAP_TEAM_TOKEN = "test-token";
    mocks.listAllRecords.mockResolvedValue([{ meta: { projectSlug: "proj-a", analyzedAt: 1 } }]);
    mocks.pushToTeam.mockRejectedValue(new Error("network down"));

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(runTeamPush("/home/user/project", undefined)).rejects.toThrow("exit");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(capturedLogs.some((l) => l.includes("network down"))).toBe(true);
    exitSpy.mockRestore();
  });
});
