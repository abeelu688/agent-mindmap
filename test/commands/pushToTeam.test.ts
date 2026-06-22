import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteStore, SessionRecord } from "../../shared/src";

// Mock the storeClient module before importing the command.
const mockIsTeamModeEnabled = vi.fn<() => Promise<boolean>>();
const mockGetLocalSqliteStore = vi.fn<() => Promise<SqliteStore | undefined>>();
const mockDrainAllPushQueues = vi.fn<() => Promise<void>>();

vi.mock("../../extension/src/store/storeClient", () => ({
  isTeamModeEnabled: (...args: unknown[]) => mockIsTeamModeEnabled(...args),
  getLocalSqliteStore: (...args: unknown[]) => mockGetLocalSqliteStore(...args),
  drainAllPushQueues: (...args: unknown[]) => mockDrainAllPushQueues(...args),
}));

// Mock the bulkPush module.
const mockSetPendingFlagsForAllProjects = vi.fn<() => Promise<void>>();
vi.mock("../../extension/src/store/bulkPush", () => ({
  setPendingFlagsForAllProjects: (...args: unknown[]) => mockSetPendingFlagsForAllProjects(...args),
}));

// Mock the l10n module to return the key.
vi.mock("../../extension/src/l10n/uiTranslate", () => ({
  t: (key: string, _defaultMsg: string, ..._args: unknown[]) => key,
}));

// Mock the notify module.
const mockNotifyWarning = vi.fn<(msg: string, ...args: unknown[]) => void>();
const mockNotifyInfo = vi.fn<(msg: string, ...args: unknown[]) => void>();
vi.mock("../../extension/src/notify", () => ({
  notifyWarning: (...args: unknown[]) => mockNotifyWarning(...args),
  notifyInfo: (...args: unknown[]) => mockNotifyInfo(...args),
}));

import { commandPushToTeam } from "../../extension/src/commands/pushToTeam";

// vscode is resolved via vitest alias to test/mocks/vscode.ts which has
// withProgress and ProgressLocation.Notification.

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "s1",
      projectSlug: "proj-a",
      projectPath: "/home/test/proj",
      transcriptPath: "/tmp/s1.jsonl",
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: "1",
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Test session",
      ...overrides,
    },
    outline: {
      title: "T",
      summary: "s",
      outline: [{ title: "Node", details: [{ text: "detail" }] }],
    },
    conceptContexts: [],
    codeReferences: [],
  };
}

describe("commandPushToTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows warning when team mode is not enabled", async () => {
    mockIsTeamModeEnabled.mockResolvedValue(false);
    await commandPushToTeam();
    expect(mockNotifyWarning).toHaveBeenCalledWith("team.push.notEnabled");
    expect(mockDrainAllPushQueues).not.toHaveBeenCalled();
  });

  it("shows warning when local store is not available", async () => {
    mockIsTeamModeEnabled.mockResolvedValue(true);
    mockGetLocalSqliteStore.mockResolvedValue(undefined);
    await commandPushToTeam();
    expect(mockNotifyWarning).toHaveBeenCalledWith("team.push.notEnabled");
    expect(mockDrainAllPushQueues).not.toHaveBeenCalled();
  });

  it("shows info when no local records exist", async () => {
    mockIsTeamModeEnabled.mockResolvedValue(true);
    const mockLocal = {
      listAllRecords: vi.fn<() => Promise<SessionRecord[]>>().mockResolvedValue([]),
    } as unknown as SqliteStore;
    mockGetLocalSqliteStore.mockResolvedValue(mockLocal);
    await commandPushToTeam();
    expect(mockNotifyInfo).toHaveBeenCalledWith("team.push.noRecords");
    expect(mockDrainAllPushQueues).not.toHaveBeenCalled();
  });

  it("sets pending flags, drains queues, shows success on push", async () => {
    const records = [sampleRecord(), sampleRecord({ sessionId: "s2", analyzedAt: 2000 })];
    const mockLocal = {
      listAllRecords: vi.fn<() => Promise<SessionRecord[]>>().mockResolvedValue(records),
    } as unknown as SqliteStore;
    mockIsTeamModeEnabled.mockResolvedValue(true);
    mockGetLocalSqliteStore.mockResolvedValue(mockLocal);
    mockDrainAllPushQueues.mockResolvedValue(undefined);

    await commandPushToTeam();

    expect(mockSetPendingFlagsForAllProjects).toHaveBeenCalledWith(mockLocal, records);
    expect(mockDrainAllPushQueues).toHaveBeenCalledTimes(1);
    // t() mock returns just the key; notifyInfo receives the t() return value.
    expect(mockNotifyInfo).toHaveBeenCalledWith("team.push.done");
  });

  it("shows partial fail warning when drain throws", async () => {
    const records = [sampleRecord()];
    const mockLocal = {
      listAllRecords: vi.fn<() => Promise<SessionRecord[]>>().mockResolvedValue(records),
    } as unknown as SqliteStore;
    mockIsTeamModeEnabled.mockResolvedValue(true);
    mockGetLocalSqliteStore.mockResolvedValue(mockLocal);
    mockDrainAllPushQueues.mockRejectedValue(new Error("network error"));

    await commandPushToTeam();

    expect(mockDrainAllPushQueues).toHaveBeenCalledTimes(1);
    // t() mock returns just the key; notifyWarning receives the t() return value.
    expect(mockNotifyWarning).toHaveBeenCalledWith("team.push.partialFail");
    expect(mockNotifyInfo).not.toHaveBeenCalled();
  });
});
