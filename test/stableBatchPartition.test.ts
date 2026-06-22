import { describe, it, expect } from "vitest";
import {
  computeStableBatchPartition,
  computeBatchGroups,
} from "../extension/src/pipeline/stableBatchPartition";
import type { SnapshotManifest, SnapshotNode } from "../extension/src/store/storeTypes";
import type { TranscriptSession } from "../extension/src/transcript/types";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeSession(id: string, mtimeMs: number): TranscriptSession {
  return {
    id,
    filePath: `/tmp/${id}.jsonl`,
    mtimeMs,
    label: `Session ${id}`,
    hostId: "cursor",
  };
}

/** Create sessions S1..Sn with mtimeMs 1000..1000+n (S1 oldest). */
function makeSessions(count: number, offset = 0): TranscriptSession[] {
  return Array.from({ length: count }, (_, i) =>
    makeSession(`S${i + 1 + offset}`, 1000 + i + offset)
  );
}

function makeManifest(
  leaves: { id: string; sessionIds: string[] }[],
  groupSize = 5
): SnapshotManifest {
  const nodes: SnapshotNode[] = leaves.map((leaf) => ({
    id: leaf.id,
    level: 1,
    childIds: [],
    sessionIds: leaf.sessionIds,
    builtAt: Date.now(),
    path: `snapshots/${leaf.id}.json`,
  }));

  const sessionToLeafId: Record<string, string> = {};
  for (const leaf of leaves) {
    for (const sid of leaf.sessionIds) {
      sessionToLeafId[sid] = leaf.id;
    }
  }

  return {
    schemaVersion: 2,
    projectSlug: "test-project",
    groupSize,
    nodes,
    topLevelIds: leaves.map((l) => l.id),
    sessionToLeafId,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("computeStableBatchPartition", () => {
  it("falls back to legacy chunking when no manifest", () => {
    const sessions = makeSessions(12);
    const plan = computeStableBatchPartition(sessions, undefined, { groupSize: 5 });

    // 12 sessions → 3 batches: 5+5+2
    expect(plan.newLeaves).toHaveLength(3);
    expect(plan.stableLeaves).toHaveLength(0);
    expect(plan.rebuildLeaves).toHaveLength(0);

    // Analysis order: mtime desc (newest first)
    expect(plan.analysisOrder[0]?.id).toBe("S12");
    expect(plan.analysisOrder[11]?.id).toBe("S1");

    // Legacy chunking sorts by mtime desc for assignment too:
    // First leaf: S12, S11, S10, S9, S8
    expect(plan.newLeaves[0]?.sessionIds).toEqual(["S12", "S11", "S10", "S9", "S8"]);
    // Second leaf: S7, S6, S5, S4, S3
    expect(plan.newLeaves[1]?.sessionIds).toEqual(["S7", "S6", "S5", "S4", "S3"]);
    // Last leaf: S2, S1
    expect(plan.newLeaves[2]?.sessionIds).toEqual(["S2", "S1"]);
  });

  it("keeps stable leaves unchanged when no new sessions", () => {
    const sessions = makeSessions(10);
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    expect(plan.stableLeaves).toHaveLength(2);
    expect(plan.rebuildLeaves).toHaveLength(0);
    expect(plan.newLeaves).toHaveLength(0);

    expect(plan.stableLeaves[0]?.leafId).toBe("l1-0001");
    expect(plan.stableLeaves[0]?.sessionIds).toEqual(["S10", "S9", "S8", "S7", "S6"]);
    expect(plan.stableLeaves[1]?.leafId).toBe("l1-0002");
    expect(plan.stableLeaves[1]?.sessionIds).toEqual(["S5", "S4", "S3", "S2", "S1"]);
  });

  it("creates new leaf for 1 new session (scenario A)", () => {
    const sessions = makeSessions(11); // S1..S11
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    expect(plan.stableLeaves).toHaveLength(2);
    expect(plan.rebuildLeaves).toHaveLength(0);
    expect(plan.newLeaves).toHaveLength(1);

    // New leaf for S11 (sorted mtime asc for leaf assignment)
    expect(plan.newLeaves[0]?.sessionIds).toEqual(["S11"]);
  });

  it("creates new leaf for 5 new sessions (scenario B)", () => {
    const sessions = makeSessions(15); // S1..S15
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    expect(plan.stableLeaves).toHaveLength(2);
    expect(plan.rebuildLeaves).toHaveLength(0);
    expect(plan.newLeaves).toHaveLength(1);
    // New sessions sorted mtime asc for leaf assignment
    expect(plan.newLeaves[0]?.sessionIds).toEqual(["S11", "S12", "S13", "S14", "S15"]);
  });

  it("marks leaf as rebuild when session is deleted (scenario D)", () => {
    // S1..S9 on disk, but manifest references S10 in l1-0001 and S3 in l1-0002.
    // S10 is not on disk → l1-0001 has orphan → rebuild
    // S3 is on disk → l1-0002 has no orphans, stays stable
    const sessions = makeSessions(9); // S1..S9 (no S10)
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] }, // S10 missing
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] }, // all present
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    // l1-0002 is stable (all sessions present)
    expect(plan.stableLeaves).toHaveLength(1);
    expect(plan.stableLeaves[0]?.leafId).toBe("l1-0002");

    // l1-0001 should be rebuilt (orphaned: S10)
    const l1 = plan.rebuildLeaves.find((l) => l.leafId === "l1-0001");
    expect(l1).toBeDefined();
    expect(l1?.reason).toBe("orphaned");
    // S9, S8, S7, S6 still exist → reassigned
  });

  it("fills partially-full last leaf when within fillThreshold", () => {
    // 8 sessions → leaves: [S8,S7,S6,S5,S4] and [S3,S2,S1]
    const sessions = makeSessions(9); // S1..S9
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S8", "S7", "S6", "S5", "S4"] },
      { id: "l1-0002", sessionIds: ["S3", "S2", "S1"] }, // 3/5 full
    ]);

    // fillThreshold=2: fill when emptySlots ≤ 2 (i.e., leaf has ≥ 3 sessions)
    const plan = computeStableBatchPartition(sessions, manifest, {
      groupSize: 5,
      fillThreshold: 2,
    });

    // l1-0001 stable, l1-0002 rebuilt (appended S9)
    expect(plan.stableLeaves).toHaveLength(1);
    expect(plan.stableLeaves[0]?.leafId).toBe("l1-0001");

    const rebuilt = plan.rebuildLeaves.find((l) => l.leafId === "l1-0002");
    expect(rebuilt).toBeDefined();
    expect(rebuilt?.reason).toBe("appended");
    expect(rebuilt?.sessionIds).toContain("S9");
    expect(rebuilt?.sessionIds).toHaveLength(4); // S3, S2, S1, S9

    expect(plan.newLeaves).toHaveLength(0);
  });

  it("does not fill partially-full leaf when beyond fillThreshold", () => {
    const sessions = makeSessions(9); // S1..S9
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S8", "S7", "S6", "S5", "S4"] },
      { id: "l1-0002", sessionIds: ["S2", "S1"] }, // 2/5 full
    ]);

    // fillThreshold=2: emptySlots=3 > 2, so don't fill l1-0002.
    // S3 and S9 are not in the manifest → they become new sessions.
    // Sorted by mtime asc for new leaf assignment: [S3, S9]
    const plan = computeStableBatchPartition(sessions, manifest, {
      groupSize: 5,
      fillThreshold: 2,
    });

    // l1-0001 and l1-0002 both stay stable (not filled)
    expect(plan.stableLeaves).toHaveLength(2);
    expect(plan.rebuildLeaves).toHaveLength(0);
    expect(plan.newLeaves).toHaveLength(1);
    // New leaf has S3 and S9 (sorted mtime asc)
    expect(plan.newLeaves[0]?.sessionIds).toEqual(["S3", "S9"]);
  });

  it("sessionToLeafId covers all sessions", () => {
    const sessions = makeSessions(11);
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    // All 11 sessions should be in the map
    expect(Object.keys(plan.sessionToLeafId)).toHaveLength(11);

    // S1-S10 map to their original leaves
    expect(plan.sessionToLeafId["S10"]).toBe("l1-0001");
    expect(plan.sessionToLeafId["S1"]).toBe("l1-0002");

    // S11 maps to the new leaf
    expect(plan.sessionToLeafId["S11"]).toMatch(/^l1-0003$/);
  });

  it("analysis order is mtime descending", () => {
    const sessions = makeSessions(11);
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });

    expect(plan.analysisOrder[0]?.id).toBe("S11");
    expect(plan.analysisOrder[1]?.id).toBe("S10");
    expect(plan.analysisOrder[10]?.id).toBe("S1");
    expect(plan.analysisOrder).toHaveLength(11);
  });
});

describe("computeBatchGroups", () => {
  it("orders sessions by analysis order across leaves", () => {
    const sessions = makeSessions(11);
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S10", "S9", "S8", "S7", "S6"] },
      { id: "l1-0002", sessionIds: ["S5", "S4", "S3", "S2", "S1"] },
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, { groupSize: 5 });
    const groups = computeBatchGroups(plan);

    // All 11 sessions should be in the groups
    expect(groups).toHaveLength(11);

    // First session should be the newest (S11) with action "new"
    expect(groups[0]?.sessionId).toBe("S11");
    expect(groups[0]?.action).toBe("new");

    // Sessions in stable leaves should have action "reuse"
    const s10Group = groups.find((g) => g.sessionId === "S10");
    expect(s10Group?.action).toBe("reuse");
    expect(s10Group?.leafId).toBe("l1-0001");
  });

  it("assigns rebuild action to appended leaves", () => {
    const sessions = makeSessions(9);
    const manifest = makeManifest([
      { id: "l1-0001", sessionIds: ["S8", "S7", "S6", "S5", "S4"] },
      { id: "l1-0002", sessionIds: ["S3", "S2", "S1"] }, // 3/5, within fillThreshold=2
    ]);

    const plan = computeStableBatchPartition(sessions, manifest, {
      groupSize: 5,
      fillThreshold: 2,
    });
    const groups = computeBatchGroups(plan);

    // S9 should be in the rebuilt l1-0002 leaf
    const s9Group = groups.find((g) => g.sessionId === "S9");
    expect(s9Group?.action).toBe("rebuild");
    expect(s9Group?.leafId).toBe("l1-0002");

    // S8 should still be in the stable l1-0001 leaf
    const s8Group = groups.find((g) => g.sessionId === "S8");
    expect(s8Group?.action).toBe("reuse");
    expect(s8Group?.leafId).toBe("l1-0001");
  });
});
