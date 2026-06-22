# Stable Batch Partition — Incremental Append for Snapshot Hierarchy

## Problem

When running "Analyze All Sessions (Current Project)", the extension:

1. Calls `listSessions()` which returns sessions sorted by **mtime descending** (newest first)
2. Chunks them sequentially into batches of `batchSize=5`
3. Each batch becomes an L1 leaf snapshot (`l1-0001`, `l1-0002`, …) in the snapshot hierarchy
4. The manifest records `sessionToLeafId` mapping each session to its leaf

When a **new session appears** and the user re-analyzes, the sorting shift causes **cascading leaf reassignment**:

### Example

**First run** — 10 sessions (S10 newest → S1 oldest):

| Batch | Sessions            | Leaf    |
| ----- | ------------------- | ------- |
| 1     | S10, S9, S8, S7, S6 | l1-0001 |
| 2     | S5, S4, S3, S2, S1  | l1-0002 |

**S11 appears, re-analyze** — 11 sessions:

| Batch | Sessions                 | Leaf                  |
| ----- | ------------------------ | --------------------- |
| 1     | **S11**, S10, S9, S8, S7 | l1-0001 (was S10..S6) |
| 2     | **S6**, S5, S4, S3, S2   | l1-0002 (was S5..S1)  |
| 3     | **S1**                   | l1-0003 (new)         |

S6 moved from l1-0001 → l1-0002, S1 moved from l1-0002 → l1-0003. **All 3 leaves** must be re-merged via LLM, even though S1–S10's content is unchanged.

### Why "oldest first" is not the answer

Sorting by mtime ascending (oldest first) would stabilize the partition for old sessions when new ones arrive. But it **sacrifices user experience**: the user cares most about the latest session, and waiting for all old sessions to be (re-)analyzed first means they see the newest results last.

The solution is to **decouple the analysis order from the snapshot partition**.

## Design

### Core Principle: Decouple Analysis Order from Snapshot Assignment

- **Analysis order** (per-session LLM calls): mtime descending — user sees latest results first
- **Snapshot assignment** (which leaf a session belongs to): stable partition based on the existing manifest

### Algorithm: `computeStableBatchPartition`

```
Input:
  - currentSessions: TranscriptSession[] (from listSessions, mtime desc)
  - manifest: SnapshotManifest | undefined
  - groupSize: number (= batchSize, default 5)
  - fillThreshold: number (default 2)

Output: PartitionPlan
  - stableLeaves: Leaf[]   — no work needed
  - rebuildLeaves: Leaf[]  — need L1 rebuild
  - newLeaves: Leaf[]      — new L1 leaf to create
  - analysisOrder: TranscriptSession[] — order for LLM processing
```

**Steps:**

1. **No manifest** → fallback to legacy mtime-desc chunking. First run for project, nothing to stabilize.

2. **Classify sessions:**
   - `assignedSessionIds`: sessions that exist in `manifest.sessionToLeafId`
   - `newSessions`: sessions NOT in `manifest.sessionToLeafId` (sorted mtime desc for analysis order)
   - `orphanedIds`: sessions in `manifest.sessionToLeafId` but NOT on disk (deleted)

3. **Mark orphan-affected leaves as rebuild:**
   - For each orphaned session, find its leaf
   - Mark that leaf as `rebuild` with reason `"orphaned"`
   - Remove those leaf sessions from `assignedSessionIds`, add to reassign pool

4. **Fill partially-full last leaf:**
   - Find the most recently created L1 leaf (highest `l1-NNNN` number)
   - If its `sessionIds.length < groupSize` AND `sessionIds.length >= groupSize - fillThreshold`:
     - Take up to `groupSize - sessionIds.length` new sessions from `newSessions`
     - Append them to this leaf, mark as `rebuild` with reason `"appended"`
   - If `sessionIds.length < groupSize - fillThreshold`: don't fill (too empty, better to keep stable and open a new leaf)

5. **Create new leaves for remaining new sessions:**
   - Chunk remaining `newSessions` into groups of `groupSize`
   - Each chunk becomes a `NewLeaf` with a fresh `leafId`
   - If the last chunk is smaller than `groupSize`, it becomes an unfilled leaf (will be fillable next run)

6. **Stable leaves** — all L1 leaves not marked as `rebuild` are `stableLeaves`.

7. **Analysis order** = all sessions sorted by mtime desc. The per-session LLM analysis loop processes them in this order. The **snapshot assignment** is independent.

### Scenario Analysis

**Scenario A: S1–S10 analyzed, S11 new (1 new session)**

| Leaf    | Sessions            | Action         |
| ------- | ------------------- | -------------- |
| l1-0001 | S10, S9, S8, S7, S6 | stable (reuse) |
| l1-0002 | S5, S4, S3, S2, S1  | stable (reuse) |
| l1-0003 | **S11**             | new            |

LLM calls: 0 leaf merges (only single-session analysis for S11, then create new leaf + promote + root rebuild).

**Scenario B: S1–S10 analyzed, S11–S15 new (5 new sessions = one full batch)**

| Leaf    | Sessions                    | Action         |
| ------- | --------------------------- | -------------- |
| l1-0001 | S10, S9, S8, S7, S6         | stable (reuse) |
| l1-0002 | S5, S4, S3, S2, S1          | stable (reuse) |
| l1-0003 | **S15, S14, S13, S12, S11** | new            |

LLM calls: 1 leaf merge for l1-0003, then promote + root rebuild.

**Scenario C: S1–S12 analyzed (3 leaves: [S12..S8], [S7..S3], [S2, S1]), S13 new**

Last leaf l1-0003 has only 2 sessions (2 < 5, but 2 >= 5-2=3? No, 2 < 3). So don't fill, create new leaf:

| Leaf    | Sessions              | Action                         |
| ------- | --------------------- | ------------------------------ |
| l1-0001 | S12, S11, S10, S9, S8 | stable                         |
| l1-0002 | S7, S6, S5, S4, S3    | stable                         |
| l1-0003 | S2, S1                | stable (not filled, too empty) |
| l1-0004 | **S13**               | new                            |

With `fillThreshold=3`: 2 >= 5-3=2, so fill:

| Leaf          | Sessions              | Action             |
| ------------- | --------------------- | ------------------ |
| l1-0001       | S12, S11, S10, S9, S8 | stable             |
| l1-0002       | S7, S6, S5, S4, S3    | stable             |
| l1-0003       | S2, S1, **S13**       | rebuild (appended) |
| (no new leaf) |                       |                    |

The default `fillThreshold=2` keeps the conservative approach: only fill when the leaf is nearly full.

**Scenario D: S3 deleted from disk**

| Leaf    | Sessions               | Action             |
| ------- | ---------------------- | ------------------ |
| l1-0001 | S10, S9, S8, S7, S6    | stable             |
| l1-0002 | S5, S4, ~~S3~~, S2, S1 | rebuild (orphaned) |

Only l1-0002 is rebuilt. l1-0001 stays stable.

### Integration Points

1. **`sessionLoader.ts` → `runProjectSessionBatches`**: Before the per-session loop, call `computeStableBatchPartition` to get the plan. The loop iterates `plan.analysisOrder`. After each leaf's sessions are processed, `onBatchDone` receives the leaf metadata.

2. **`commands/analyzeProject.ts` → `onBatchDone`**: Use `leafAction` to decide merge strategy:
   - `"reuse"` → skip merge (leaf is stable, on-disk snapshot is valid)
   - `"rebuild"` → `refreshSnapshotForSession` for the leaf
   - `"new"` → `runBatchSnapshotPipeline` for the new leaf

3. **`batch/conceptMerge.ts` → `refreshSnapshotsForFreshSessions`**: Already handles the "sessions with leaf" vs "sessions needing new leaf" split. The stable partition just provides better pre-computed groupings.

### Backward Compatibility

- No manifest → legacy mtime-desc chunking (identical to current behavior)
- Force refresh → manifest cleared, falls back to legacy
- All leaves marked rebuild → equivalent to full rebuild (same as current)
- `fillThreshold=0` → never fill partial leaves, always create new ones (most conservative)

### Fill Threshold Rationale

`fillThreshold` controls how aggressively we fill partially-full leaves:

- **Low threshold (0–1)**: Almost never fill → more leaf fragmentation but maximum stability
- **Medium threshold (2)**: Fill when leaf has ≥ 3/5 sessions → reduces fragmentation while keeping rebuild cost low
- **High threshold (3–4)**: Fill aggressively → less fragmentation but more rebuilds

Default `2` balances: a leaf with 3/5 sessions only needs 2 more, so the rebuild cost is small relative to the fragmentation savings.
