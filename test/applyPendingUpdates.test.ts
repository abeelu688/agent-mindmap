import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MindMapRoot } from "../extension/src/transcript/types";
import type { MergeRecord } from "../extension/src/store/storeTypes";

const mocks = vi.hoisted(() => ({
  rebuildProjectMergeMock: vi.fn(),
  rebuildSingleSessionMock: vi.fn(),
  writeMergeRecordMock: vi.fn(),
  getStoreDirMock: vi.fn(() => "/tmp/store"),
}));

vi.mock("../extension/src/mindmap/rebuildMindMapFromStore", () => ({
  conceptTrieMergePath: vi.fn(() => "/tmp/store/merge.json"),
  rebuildProjectMergeFromStore: mocks.rebuildProjectMergeMock,
  rebuildSingleSessionMindMapFromStore: mocks.rebuildSingleSessionMock,
  resolveProjectSlugFromMindMap: (mindMap: MindMapRoot | undefined) =>
    mindMap?.data.origin?.refs?.[0]?.projectSlug,
}));

vi.mock("../extension/src/store/sessionStore", () => ({
  writeMergeRecord: mocks.writeMergeRecordMock,
}));

vi.mock("../extension/src/paths", () => ({
  getStoreDir: mocks.getStoreDirMock,
}));

vi.mock("../extension/src/codeRefQueue", () => ({
  getProjectSessionIdsOnMap: (mindMap: MindMapRoot | undefined, projectSlug: string) => {
    const refs = mindMap?.data.origin?.refs ?? [];
    return new Set(
      refs.filter((ref) => ref.projectSlug === projectSlug).map((ref) => ref.sessionId)
    );
  },
}));

import {
  applyPendingUpdatesToPanel,
  hasPendingPanelUpdates,
} from "../extension/src/batch/applyPendingUpdates";
import {
  clearPendingMerge,
  getLastBatchStatus,
  setLastBatchStatus,
  setPendingMindMap,
} from "../extension/src/batch/batchStatus";

function makeMindMap(sessionIds: string[], projectSlug = "proj"): MindMapRoot {
  return {
    data: {
      topic: "Test",
      origin: {
        refs: sessionIds.map((sessionId) => ({
          sessionId,
          projectSlug,
          sessionLabel: sessionId,
          transcriptPath: `/tmp/${sessionId}.jsonl`,
        })),
      },
    },
  } as MindMapRoot;
}

function makePanel(initial?: MindMapRoot) {
  let data = initial;
  return {
    getMindMapData: () => data,
    setMindMapData: (next: MindMapRoot) => {
      data = next;
    },
    setBatchStatus: vi.fn(),
  };
}

describe("applyPendingUpdatesToPanel", () => {
  beforeEach(() => {
    clearPendingMerge();
    setLastBatchStatus({
      total: 2,
      processed: 2,
      analyzed: 2,
      cached: 0,
      failed: 0,
      batchNo: 1,
      running: false,
    });
    mocks.rebuildProjectMergeMock.mockReset();
    mocks.rebuildSingleSessionMock.mockReset();
    mocks.writeMergeRecordMock.mockReset();
  });

  afterEach(() => {
    clearPendingMerge();
  });

  it("returns false when nothing is pending", async () => {
    const panel = makePanel();
    expect(hasPendingPanelUpdates()).toBe(false);
    await expect(applyPendingUpdatesToPanel(panel)).resolves.toBe(false);
  });

  it("rebuilds merged map from store and clears batch + code-ref pending flags", async () => {
    const staleMap = makeMindMap(["s1", "s2"], "proj");
    const freshMap = makeMindMap(["s1", "s2"], "proj");
    const merge: MergeRecord = {
      mindMap: freshMap,
      meta: {} as MergeRecord["meta"],
      conceptTrie: {} as MergeRecord["conceptTrie"],
    };
    mocks.rebuildProjectMergeMock.mockResolvedValue(merge);

    setPendingMindMap(staleMap, 2);
    setLastBatchStatus({
      ...getLastBatchStatus()!,
      pendingUpdateBatchNo: 2,
      pendingUpdateLabel: "Related code",
    });

    const panel = makePanel(makeMindMap(["s1", "s2"], "proj"));
    await expect(applyPendingUpdatesToPanel(panel)).resolves.toBe(true);

    expect(mocks.rebuildProjectMergeMock).toHaveBeenCalledWith("/tmp/store", "proj");
    expect(mocks.writeMergeRecordMock).toHaveBeenCalled();
    expect(panel.getMindMapData()).toBe(freshMap);
    expect(getLastBatchStatus()?.pendingUpdateBatchNo).toBeUndefined();
    expect(getLastBatchStatus()?.pendingUpdateLabel).toBeUndefined();
  });

  it("rebuilds single-session map when only one session is on the map", async () => {
    const freshMap = makeMindMap(["s1"], "proj");
    mocks.rebuildSingleSessionMock.mockResolvedValue(freshMap);

    setPendingMindMap(freshMap, undefined, "Related code");
    setLastBatchStatus({
      ...getLastBatchStatus()!,
      pendingUpdateLabel: "Related code",
    });

    const panel = makePanel(makeMindMap(["s1"], "proj"));
    await expect(applyPendingUpdatesToPanel(panel)).resolves.toBe(true);

    expect(mocks.rebuildSingleSessionMock).toHaveBeenCalledWith("/tmp/store", "proj", "s1");
    expect(mocks.rebuildProjectMergeMock).not.toHaveBeenCalled();
    expect(getLastBatchStatus()?.pendingUpdateLabel).toBeUndefined();
  });
});
