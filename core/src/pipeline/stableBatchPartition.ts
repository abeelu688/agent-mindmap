import type { SnapshotManifest, SnapshotNode } from "../store/storeTypes";
import type { TranscriptSession } from "../transcript/types";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** An L1 leaf that is unchanged — its on-disk snapshot is still valid. */
export type StableLeaf = {
  leafId: string;
  sessionIds: string[];
};

/** An L1 leaf that needs rebuilding (orphaned sessions removed or new sessions appended). */
export type RebuildLeaf = {
  leafId: string;
  /** Final session list for this leaf after rebuild. */
  sessionIds: string[];
  reason: "orphaned" | "appended";
};

/** A brand-new L1 leaf to create from scratch. */
export type NewLeaf = {
  leafId: string;
  sessionIds: string[];
};

/** The complete partition plan for a batch analysis run. */
export type PartitionPlan = {
  /** Leaves that are unchanged — their on-disk snapshots are still valid. */
  stableLeaves: StableLeaf[];
  /** Leaves that need rebuilding. */
  rebuildLeaves: RebuildLeaf[];
  /** New leaves to create. */
  newLeaves: NewLeaf[];
  /** Per-session analysis order (mtime descending) for LLM processing. */
  analysisOrder: TranscriptSession[];
  /** Map: sessionId → leafId (for the final manifest update). */
  sessionToLeafId: Record<string, string>;
};

export type StablePartitionOpts = {
  /** Sessions per L1 batch. Default 5. */
  groupSize?: number;
  /**
   * How many slots can be empty in a partial leaf before we fill it with new
   * sessions (vs. creating a new leaf). Default 2: fill when the leaf has
   * ≥ groupSize - fillThreshold sessions.
   */
  fillThreshold?: number;
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Sort sessions by mtime descending (newest first). */
function sortByMtimeDesc(sessions: TranscriptSession[]): TranscriptSession[] {
  return [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Sort sessions by mtime ascending (oldest first). */
function sortByMtimeAsc(sessions: TranscriptSession[]): TranscriptSession[] {
  return [...sessions].sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/** Extract the numeric suffix from a leaf id like "l1-0003". */
function leafNumber(leafId: string): number {
  const match = leafId.match(/^l1-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Generate the next leaf id based on existing L1 nodes. */
function nextLeafId(existingLeaves: SnapshotNode[] | StableLeaf[] | NewLeaf[]): string {
  let maxNum = 0;
  for (const leaf of existingLeaves) {
    const num = "id" in leaf ? leafNumber((leaf as SnapshotNode).id) : 0;
    if (num > maxNum) {
      maxNum = num;
    }
  }
  return `l1-${String(maxNum + 1).padStart(4, "0")}`;
}

/** Generate the next leaf id from a set of leaf ids (strings). */
function nextLeafIdFromIds(leafIds: string[]): string {
  let maxNum = 0;
  for (const id of leafIds) {
    const num = leafNumber(id);
    if (num > maxNum) {
      maxNum = num;
    }
  }
  return `l1-${String(maxNum + 1).padStart(4, "0")}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy chunking (no manifest)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fallback: chunk sessions by mtime-desc into fixed-size batches.
 * This is identical to the original `runProjectSessionBatches` behavior.
 */
function legacyChunking(sessions: TranscriptSession[], groupSize: number): PartitionPlan {
  const sorted = sortByMtimeDesc(sessions);
  const allLeafIds: string[] = [];
  const newLeaves: NewLeaf[] = [];

  for (let i = 0; i < sorted.length; i += groupSize) {
    const chunk = sorted.slice(i, i + groupSize);
    const leafId = nextLeafIdFromIds(allLeafIds);
    allLeafIds.push(leafId);
    newLeaves.push({
      leafId,
      sessionIds: chunk.map((s) => s.id),
    });
  }

  const sessionToLeafId: Record<string, string> = {};
  for (const leaf of newLeaves) {
    for (const sid of leaf.sessionIds) {
      sessionToLeafId[sid] = leaf.leafId;
    }
  }

  return {
    stableLeaves: [],
    rebuildLeaves: [],
    newLeaves,
    analysisOrder: sorted,
    sessionToLeafId,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Core algorithm
// ────────────────────────────────────────────────────────────────────────────

/**
 * Compute a stable batch partition for the given set of sessions and an
 * optional existing manifest.
 *
 * When no manifest exists (first run), falls back to legacy mtime-desc
 * chunking. When a manifest exists, classifies sessions into stable/rebuild/
 * new leaves to minimize LLM re-merge work.
 */
export function computeStableBatchPartition(
  sessions: TranscriptSession[],
  manifest: SnapshotManifest | undefined,
  opts: StablePartitionOpts = {}
): PartitionPlan {
  const groupSize = opts.groupSize ?? 5;
  const fillThreshold = opts.fillThreshold ?? 2;

  // No manifest → legacy chunking
  if (!manifest || manifest.nodes.length === 0) {
    return legacyChunking(sessions, groupSize);
  }

  const sessionById = new Map<string, TranscriptSession>();
  for (const s of sessions) {
    sessionById.set(s.id, s);
  }

  // ── Step 2: Classify sessions ──────────────────────────────────────────

  const diskSessionIds = new Set(sessions.map((s) => s.id));
  const manifestSessionIds = new Set(Object.keys(manifest.sessionToLeafId));

  // Sessions on disk that are already assigned to a leaf
  const assignedSessionIds = new Set<string>();
  // Sessions on disk that are NOT in the manifest
  const newSessionIds = new Set<string>();
  // Sessions in the manifest but NOT on disk (deleted)
  const orphanedIds = new Set<string>();

  for (const sid of diskSessionIds) {
    if (manifestSessionIds.has(sid)) {
      assignedSessionIds.add(sid);
    } else {
      newSessionIds.add(sid);
    }
  }

  for (const sid of manifestSessionIds) {
    if (!diskSessionIds.has(sid)) {
      orphanedIds.add(sid);
    }
  }

  // ── Step 3: Find orphan-affected leaves ────────────────────────────────

  const l1Nodes = manifest.nodes
    .filter((n) => n.level === 1)
    .sort((a, b) => a.id.localeCompare(b.id));

  const orphanedLeafIds = new Set<string>();
  for (const sid of orphanedIds) {
    const leafId = manifest.sessionToLeafId[sid];
    if (leafId) {
      orphanedLeafIds.add(leafId);
    }
  }

  // ── Step 4: Classify existing leaves ───────────────────────────────────

  const stableLeaves: StableLeaf[] = [];
  const rebuildLeaves: RebuildLeaf[] = [];
  const allLeafIds: string[] = l1Nodes.map((n) => n.id);

  // Track which sessions are already assigned to a leaf
  const assignedToLeaf = new Map<string, string>(); // sessionId → leafId

  for (const node of l1Nodes) {
    // Collect surviving sessions for this leaf (on disk)
    const survivingSessionIds = node.sessionIds.filter((sid) => assignedSessionIds.has(sid));

    if (orphanedLeafIds.has(node.id)) {
      // This leaf has orphaned sessions — mark as rebuild with surviving sessions.
      // We keep the leaf ID stable so higher-level snapshots still reference it.
      if (survivingSessionIds.length > 0) {
        rebuildLeaves.push({
          leafId: node.id,
          sessionIds: survivingSessionIds,
          reason: "orphaned",
        });
        for (const sid of survivingSessionIds) {
          assignedToLeaf.set(sid, node.id);
        }
      }
      // If all sessions were orphaned, the leaf is effectively empty.
      // Don't add it anywhere — it will be abandoned.
      continue;
    }

    // If ALL sessions survived, this leaf is stable
    if (survivingSessionIds.length === node.sessionIds.length) {
      stableLeaves.push({
        leafId: node.id,
        sessionIds: survivingSessionIds,
      });
      for (const sid of survivingSessionIds) {
        assignedToLeaf.set(sid, node.id);
      }
      continue;
    }

    // Some sessions disappeared (shouldn't happen if orphan detection is
    // correct, but handle gracefully) — mark as rebuild
    rebuildLeaves.push({
      leafId: node.id,
      sessionIds: survivingSessionIds,
      reason: "orphaned",
    });
    for (const sid of survivingSessionIds) {
      assignedToLeaf.set(sid, node.id);
    }
  }

  // ── Step 5: Fill partially-full last leaf ───────────────────────────────

  // New sessions sorted by mtime ascending for filling (oldest first →
  // stable assignment). We want the newest sessions to go into new leaves
  // so they're available for analysis first.
  const newSessionList = [...newSessionIds]
    .map((id) => sessionById.get(id))
    .filter((s): s is TranscriptSession => Boolean(s));

  // Sessions available for new leaf assignment
  let availableNewSessions = sortByMtimeAsc(newSessionList);
  const newLeaves: NewLeaf[] = [];

  // Find the most recently created L1 leaf that is NOT orphaned
  // and is partially full
  const nonOrphanL1 = l1Nodes.filter((n) => !orphanedLeafIds.has(n.id));

  // Check if the last (highest-numbered) leaf is partially full
  const lastL1 =
    nonOrphanL1.length > 0
      ? nonOrphanL1.reduce((a, b) => (leafNumber(a.id) > leafNumber(b.id) ? a : b))
      : undefined;

  if (lastL1 && lastL1.sessionIds.length < groupSize) {
    const emptySlots = groupSize - lastL1.sessionIds.length;
    const isNearlyFull = emptySlots <= fillThreshold;

    if (isNearlyFull && availableNewSessions.length > 0) {
      // Fill this leaf with new sessions
      const toFill = availableNewSessions.slice(0, emptySlots);
      const filledSessionIds = [
        ...lastL1.sessionIds.filter((sid) => assignedSessionIds.has(sid)),
        ...toFill.map((s) => s.id),
      ];

      // Change from stable to rebuild if it was marked stable
      const stableIdx = stableLeaves.findIndex((l) => l.leafId === lastL1.id);
      if (stableIdx >= 0) {
        stableLeaves.splice(stableIdx, 1);
      }
      const rebuildIdx = rebuildLeaves.findIndex((l) => l.leafId === lastL1.id);
      if (rebuildIdx >= 0) {
        rebuildLeaves.splice(rebuildIdx, 1);
      }

      rebuildLeaves.push({
        leafId: lastL1.id,
        sessionIds: filledSessionIds,
        reason: "appended",
      });

      for (const s of toFill) {
        assignedToLeaf.set(s.id, lastL1.id);
      }

      // Remove filled sessions from available pool
      const filledIds = new Set(toFill.map((s) => s.id));
      availableNewSessions = availableNewSessions.filter((s) => !filledIds.has(s.id));
    }
  }

  // ── Step 6: Create new leaves for remaining sessions ───────────────────

  // Sort remaining sessions by mtime ascending for consistent leaf assignment
  // (oldest sessions fill the first new leaf)
  const remainingSorted = sortByMtimeAsc(availableNewSessions);

  for (let i = 0; i < remainingSorted.length; i += groupSize) {
    const chunk = remainingSorted.slice(i, i + groupSize);
    const leafId = nextLeafIdFromIds(allLeafIds);
    allLeafIds.push(leafId);
    const sessionIds = chunk.map((s) => s.id);
    newLeaves.push({ leafId, sessionIds });
    for (const sid of sessionIds) {
      assignedToLeaf.set(sid, leafId);
    }
  }

  // ── Step 7: Build analysis order ───────────────────────────────────────

  const analysisOrder = sortByMtimeDesc(sessions);

  // ── Build sessionToLeafId map ──────────────────────────────────────────

  const sessionToLeafId: Record<string, string> = {};
  for (const leaf of stableLeaves) {
    for (const sid of leaf.sessionIds) {
      sessionToLeafId[sid] = leaf.leafId;
    }
  }
  for (const leaf of rebuildLeaves) {
    for (const sid of leaf.sessionIds) {
      sessionToLeafId[sid] = leaf.leafId;
    }
  }
  for (const leaf of newLeaves) {
    for (const sid of leaf.sessionIds) {
      sessionToLeafId[sid] = leaf.leafId;
    }
  }

  return {
    stableLeaves,
    rebuildLeaves,
    newLeaves,
    analysisOrder,
    sessionToLeafId,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Utility: batch boundary detection for the analysis loop
// ────────────────────────────────────────────────────────────────────────────

export type LeafAction = "reuse" | "rebuild" | "new";

export type LeafBatchInfo = {
  leafId: string;
  action: LeafAction;
  sessionIds: string[];
  reason?: string;
};

/**
 * Map the partition plan into per-leaf batch info for the analysis loop.
 * This tells the caller which action to take after processing a leaf's sessions.
 */
export function getLeafBatchesFromPlan(plan: PartitionPlan): LeafBatchInfo[] {
  const batches: LeafBatchInfo[] = [];

  for (const leaf of plan.rebuildLeaves) {
    batches.push({
      leafId: leaf.leafId,
      action: "rebuild",
      sessionIds: leaf.sessionIds,
      reason: leaf.reason,
    });
  }

  for (const leaf of plan.newLeaves) {
    batches.push({
      leafId: leaf.leafId,
      action: "new",
      sessionIds: leaf.sessionIds,
    });
  }

  // Stable leaves are not included — they don't need any processing.
  // If the caller wants to know about them for UI purposes, they can
  // iterate plan.stableLeaves directly.

  return batches;
}

/**
 * For the analysis loop: given a list of sessions in analysis order and a
 * partition plan, yield groups of sessionIds that form a "batch" for
 * onBatchDone reporting.
 *
 * Each group corresponds to one leaf from the partition plan. Sessions
 * belonging to stable leaves are grouped separately (they still need
 * per-session analysis for cache-hit checking, but the merge step is skipped).
 */
export function computeBatchGroups(
  plan: PartitionPlan
): { sessionId: string; leafId: string; action: LeafAction }[] {
  const result: { sessionId: string; leafId: string; action: LeafAction }[] = [];

  for (const leaf of plan.stableLeaves) {
    for (const sid of leaf.sessionIds) {
      result.push({ sessionId: sid, leafId: leaf.leafId, action: "reuse" });
    }
  }

  for (const leaf of plan.rebuildLeaves) {
    for (const sid of leaf.sessionIds) {
      result.push({ sessionId: sid, leafId: leaf.leafId, action: "rebuild" });
    }
  }

  for (const leaf of plan.newLeaves) {
    for (const sid of leaf.sessionIds) {
      result.push({ sessionId: sid, leafId: leaf.leafId, action: "new" });
    }
  }

  // Sort to match analysis order (mtime desc)
  const analysisOrderIds = plan.analysisOrder.map((s) => s.id);
  const orderMap = new Map(analysisOrderIds.map((id, idx) => [id, idx]));

  result.sort((a, b) => {
    const ai = orderMap.get(a.sessionId) ?? Infinity;
    const bi = orderMap.get(b.sessionId) ?? Infinity;
    return ai - bi;
  });

  return result;
}
