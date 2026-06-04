import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
import type { MindMapProgress } from "../progress";
import {
  buildMergeSnapshotFromVirtualSession,
  createEmptySnapshotManifest,
  DEFAULT_SNAPSHOT_GROUP_SIZE,
  filterRealSessionRecords,
  findLeafNodeForSession,
  findParentNode,
  MERGE_SNAPSHOT_SESSION_ID,
  readMergeSnapshot,
  readSnapshotById,
  readSnapshotManifest,
  snapshotToSessionRecord,
  snapshotVirtualSessionId,
  writeMergeSnapshot,
  writeSnapshotByPath,
  writeSnapshotManifest,
} from "../store/mergeSnapshot";
import type {
  MergeRecord,
  MergeSnapshot,
  SessionRecord,
  SnapshotManifest,
  SnapshotNode,
} from "../store/storeTypes";
import { runMergePipeline } from "./mergePipeline";
import { finalizeSessionAnalysis } from "./stages/finalizeSessionAnalysis";
import type { FinalizedSessionAnalysis } from "./stages/finalizeSessionAnalysis";
import { updateConceptTrieAsync } from "./stages/updateConceptTrie";
import { mindMapLog } from "../webview/MindMapLog";
import {
  conceptTrieMergePath,
  writeMergeRecord,
} from "../store/sessionStore";

export type SnapshotHierarchyLlmOpts = {
  storeDir: string;
  projectSlug: string;
  allRecords: SessionRecord[];
  provider: LlmProvider;
  providerId: string;
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: "zh" | "en";
  llmTimeoutMs?: number;
  signal: AbortSignal;
  groupSize?: number;
  forceReattach?: boolean;
};

export type RunLeafSnapshotMergeOpts = SnapshotHierarchyLlmOpts & {
  batchRecords: SessionRecord[];
  batchNo: number;
  /** When set, replace this existing L1 node instead of creating a new one. */
  existingLeafId?: string;
};

export type RunBatchSnapshotPipelineOpts = SnapshotHierarchyLlmOpts & {
  batchRecords: SessionRecord[];
  batchNo: number;
};

function groupSizeFor(manifest: SnapshotManifest): number {
  return Math.max(1, manifest.groupSize || DEFAULT_SNAPSHOT_GROUP_SIZE);
}

async function ensureManifest(
  storeDir: string,
  projectSlug: string,
  groupSize?: number
): Promise<SnapshotManifest> {
  const existing = await readSnapshotManifest(storeDir, projectSlug);
  if (existing) {
    return existing;
  }
  return createEmptySnapshotManifest(
    projectSlug,
    groupSize ?? DEFAULT_SNAPSHOT_GROUP_SIZE
  );
}

function leafSnapshotId(batchNo: number): string {
  return `l1-${String(batchNo).padStart(4, "0")}`;
}

function nextGroupSnapshotId(manifest: SnapshotManifest, level: number): string {
  const atLevel = manifest.nodes.filter((n) => n.level === level);
  return `l${level}-${String(atLevel.length + 1).padStart(4, "0")}`;
}

function unionSessionIds(nodes: SnapshotNode[]): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const sid of node.sessionIds) {
      ids.add(sid);
    }
  }
  return [...ids].sort();
}

function virtualFromSingleRecord(record: SessionRecord): FinalizedSessionAnalysis {
  if (!record.sessionAnalysis) {
    throw new Error(
      `[agent-mindmap] Session ${record.meta.sessionId} has no sessionAnalysis for leaf snapshot projection`
    );
  }
  return finalizeSessionAnalysis(record.sessionAnalysis, {
    sessionId: record.meta.sessionId,
    projectSlug: record.meta.projectSlug,
    userQueryCount: record.meta.userQueryCount ?? 0,
  });
}

async function runBoundedMerge(
  opts: SnapshotHierarchyLlmOpts,
  llmRecords: SessionRecord[],
  m3Records: SessionRecord[],
  progress: MindMapProgress | undefined,
  pipelineOpts: {
    skipM3: boolean;
    mergeMode?: "full" | "delta";
    snapshotSessionId?: string;
  }
): Promise<{
  virtualSession?: FinalizedSessionAnalysis;
  merge: MergeRecord;
  segmentEquivalences: import("../llm/types").SegmentEquivalence[];
}> {
  const result = await runMergePipeline(
    {
      storeDir: opts.storeDir,
      records: m3Records,
      llmRecords,
      projectSlug: opts.projectSlug,
      model: opts.model,
      hostId: opts.hostId,
      providerId: opts.providerId,
      promptLanguage: opts.promptLanguage,
      refineMode: "batch",
      incrementalFromIndex: true,
      forceReattach: opts.forceReattach ?? true,
      mergeMode: pipelineOpts.mergeMode ?? "full",
      snapshotSessionId: pipelineOpts.snapshotSessionId,
      llmTimeoutMs: opts.llmTimeoutMs,
      skipM3: pipelineOpts.skipM3,
      signal: opts.signal,
    },
    opts.provider,
    progress
  );

  const virtualSession =
    result.virtualSession ??
    (result.ontology.mergeSessionAnalysis
      ? finalizeSessionAnalysis(result.ontology.mergeSessionAnalysis, {
          sessionId: MERGE_SNAPSHOT_SESSION_ID,
          projectSlug: opts.projectSlug,
          userQueryCount: 0,
        })
      : undefined);

  if (!virtualSession) {
    throw new Error(
      "[agent-mindmap] M-merge produced no virtual session for snapshot hierarchy merge"
    );
  }

  return {
    virtualSession,
    merge: result.merge,
    segmentEquivalences: result.ontology.segmentEquivalences ?? [],
  };
}

async function loadSnapshotsForNodes(
  storeDir: string,
  projectSlug: string,
  nodes: SnapshotNode[]
): Promise<MergeSnapshot[]> {
  const out: MergeSnapshot[] = [];
  for (const node of nodes) {
    const snap = await readSnapshotById(storeDir, projectSlug, node);
    if (!snap) {
      throw new Error(
        `[agent-mindmap] Missing snapshot file for node ${node.id} at ${node.path}`
      );
    }
    out.push(snap);
  }
  return out;
}

async function mergeSnapshotGroup(
  childNodes: SnapshotNode[],
  parentLevel: number,
  parentId: string,
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<{ snapshot: MergeSnapshot; node: SnapshotNode }> {
  const childSnapshots = await loadSnapshotsForNodes(
    opts.storeDir,
    opts.projectSlug,
    childNodes
  );
  const virtualRecords = childSnapshots.map((snap) =>
    snapshotToSessionRecord(
      snap,
      snapshotVirtualSessionId(snap.meta.snapshotId ?? childNodes[0]!.id)
    )
  );
  const sessionIds = unionSessionIds(childNodes);
  const relativePath = `snapshots/${parentId}.json`;

  progress?.report(
    `M-merge (L${parentLevel}): merging ${childNodes.length} snapshot(s)…`
  );

  const { virtualSession, segmentEquivalences } = await runBoundedMerge(
    opts,
    virtualRecords,
    virtualRecords,
    progress,
    { skipM3: true, mergeMode: "full" }
  );

  const snapshot = buildMergeSnapshotFromVirtualSession(
    virtualRecords,
    virtualSession,
    opts.projectSlug,
    segmentEquivalences,
    {
      snapshotId: parentId,
      level: parentLevel,
      childSnapshotIds: childNodes.map((n) => n.id),
      sessionIds,
    }
  );

  await writeSnapshotByPath(
    opts.storeDir,
    opts.projectSlug,
    relativePath,
    snapshot
  );

  const node: SnapshotNode = {
    id: parentId,
    level: parentLevel,
    childIds: childNodes.map((n) => n.id),
    sessionIds,
    builtAt: Date.now(),
    path: relativePath,
  };

  return { snapshot, node };
}

function removeFromTopLevel(manifest: SnapshotManifest, ids: string[]): void {
  const remove = new Set(ids);
  manifest.topLevelIds = manifest.topLevelIds.filter((id) => !remove.has(id));
}

function upsertManifestNode(manifest: SnapshotManifest, node: SnapshotNode): void {
  const idx = manifest.nodes.findIndex((n) => n.id === node.id);
  if (idx >= 0) {
    manifest.nodes[idx] = node;
  } else {
    manifest.nodes.push(node);
  }
  const hasParent = manifest.nodes.some((n) => n.childIds.includes(node.id));
  if (hasParent) {
    manifest.topLevelIds = manifest.topLevelIds.filter((id) => id !== node.id);
    return;
  }
  if (!manifest.topLevelIds.includes(node.id)) {
    manifest.topLevelIds.push(node.id);
  }
}

function bindSessionsToLeaf(
  manifest: SnapshotManifest,
  leafId: string,
  sessionIds: string[],
  previousSessionIds?: string[]
): void {
  if (previousSessionIds) {
    for (const sid of previousSessionIds) {
      if (manifest.sessionToLeafId[sid] === leafId) {
        delete manifest.sessionToLeafId[sid];
      }
    }
  }
  for (const sid of sessionIds) {
    manifest.sessionToLeafId[sid] = leafId;
  }
}

async function promoteLevel(
  manifest: SnapshotManifest,
  level: number,
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<void> {
  const size = groupSizeFor(manifest);
  while (true) {
    const atLevel = manifest.topLevelIds
      .map((id) => manifest.nodes.find((n) => n.id === id))
      .filter((n): n is SnapshotNode => Boolean(n) && n.level === level)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (atLevel.length < size) {
      return;
    }

    const group = atLevel.slice(0, size);
    const parentLevel = level + 1;
    const parentId = nextGroupSnapshotId(manifest, parentLevel);

    const { node } = await mergeSnapshotGroup(
      group,
      parentLevel,
      parentId,
      opts,
      progress
    );

    removeFromTopLevel(
      manifest,
      group.map((n) => n.id)
    );
    upsertManifestNode(manifest, node);
    await writeSnapshotManifest(opts.storeDir, manifest);

    await promoteLevel(manifest, parentLevel, opts, progress);
  }
}

async function promoteAllLevels(
  manifest: SnapshotManifest,
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<void> {
  await promoteLevel(manifest, 1, opts, progress);
}

/**
 * M-merge batch sessions into an L1 leaf snapshot (no M3).
 */
export async function runLeafSnapshotMerge(
  opts: RunLeafSnapshotMergeOpts,
  progress?: MindMapProgress
): Promise<{ leafId: string; snapshot: MergeSnapshot }> {
  const batchReal = filterRealSessionRecords(opts.batchRecords);
  if (batchReal.length === 0) {
    throw new Error("[agent-mindmap] runLeafSnapshotMerge: empty batch");
  }

  const manifest = await ensureManifest(
    opts.storeDir,
    opts.projectSlug,
    opts.groupSize
  );
  const leafId = opts.existingLeafId ?? leafSnapshotId(opts.batchNo);
  const relativePath = `snapshots/${leafId}.json`;
  const sessionIds = batchReal.map((r) => r.meta.sessionId).sort();
  const previousNode = manifest.nodes.find((n) => n.id === leafId);
  const previousSessionIds = previousNode?.sessionIds;

  progress?.report(
    `M-merge (L1 batch ${opts.batchNo}): ${batchReal.length} session(s)…`
  );

  let virtualSession: FinalizedSessionAnalysis;
  let segmentEquivalences: import("../llm/types").SegmentEquivalence[] = [];

  if (batchReal.length === 1) {
    virtualSession = virtualFromSingleRecord(batchReal[0]!);
    segmentEquivalences =
      virtualSession.sessionSynonyms.segmentEquivalences ?? [];
  } else {
    const merged = await runBoundedMerge(
      opts,
      batchReal,
      batchReal,
      progress,
      { skipM3: true, mergeMode: "full" }
    );
    virtualSession = merged.virtualSession;
    segmentEquivalences = merged.segmentEquivalences;
  }

  const snapshot = buildMergeSnapshotFromVirtualSession(
    batchReal,
    virtualSession,
    opts.projectSlug,
    segmentEquivalences,
    {
      snapshotId: leafId,
      level: 1,
      sessionIds,
    }
  );

  await writeSnapshotByPath(
    opts.storeDir,
    opts.projectSlug,
    relativePath,
    snapshot
  );

  const node: SnapshotNode = {
    id: leafId,
    level: 1,
    childIds: [],
    sessionIds,
    builtAt: Date.now(),
    path: relativePath,
  };

  upsertManifestNode(manifest, node);
  bindSessionsToLeaf(manifest, leafId, sessionIds, previousSessionIds);
  await writeSnapshotManifest(opts.storeDir, manifest);

  return { leafId, snapshot };
}

/**
 * Merge all top-level snapshot nodes into root + M3 on full library.
 */
export async function rebuildProjectRoot(
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const allReal = filterRealSessionRecords(opts.allRecords);
  const manifest = await readSnapshotManifest(opts.storeDir, opts.projectSlug);

  if (!manifest || manifest.topLevelIds.length === 0) {
    throw new Error(
      "[agent-mindmap] rebuildProjectRoot: no snapshot hierarchy top-level nodes"
    );
  }

  const topNodes = manifest.topLevelIds
    .map((id) => manifest.nodes.find((n) => n.id === id))
    .filter((n): n is SnapshotNode => Boolean(n))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (topNodes.length === 0) {
    throw new Error(
      "[agent-mindmap] rebuildProjectRoot: topLevelIds reference missing nodes"
    );
  }

  let rootSnapshot: MergeSnapshot;

  if (topNodes.length === 1) {
    const only = await readSnapshotById(
      opts.storeDir,
      opts.projectSlug,
      topNodes[0]!
    );
    if (!only) {
      throw new Error(
        `[agent-mindmap] rebuildProjectRoot: missing snapshot ${topNodes[0]!.id}`
      );
    }
    rootSnapshot = {
      ...only,
      meta: {
        ...only.meta,
        level: 0,
        snapshotId: only.meta.snapshotId ?? topNodes[0]!.id,
      },
    };
  } else {
    const topSnapshots = await loadSnapshotsForNodes(
      opts.storeDir,
      opts.projectSlug,
      topNodes
    );
    const virtualRecords = topSnapshots.map((snap, i) =>
      snapshotToSessionRecord(
        snap,
        snapshotVirtualSessionId(snap.meta.snapshotId ?? topNodes[i]!.id)
      )
    );
    const sessionIds = unionSessionIds(topNodes);

    progress?.report(
      `M-merge (root): merging ${topNodes.length} top-level snapshot(s)…`
    );

    const { virtualSession, segmentEquivalences } = await runBoundedMerge(
      opts,
      virtualRecords,
      virtualRecords,
      progress,
      { skipM3: true, mergeMode: "full" }
    );

    rootSnapshot = buildMergeSnapshotFromVirtualSession(
      allReal,
      virtualSession,
      opts.projectSlug,
      segmentEquivalences,
      {
        snapshotId: "root",
        level: 0,
        childSnapshotIds: topNodes.map((n) => n.id),
        sessionIds,
      }
    );
  }

  manifest.rootSnapshotId = rootSnapshot.meta.snapshotId;
  await writeSnapshotManifest(opts.storeDir, manifest);
  await writeMergeSnapshot(opts.storeDir, rootSnapshot);

  progress?.report("M3: Updating concept trie from root snapshot…");
  try {
    const merge = await updateConceptTrieAsync({
      records: allReal,
      segmentEquivalences: rootSnapshot.segmentEquivalences,
      virtualSessionAnalysis: rootSnapshot.sessionAnalysis,
      projectSlug: opts.projectSlug,
    });
    const topCount =
      merge.mindMap?.nodeData?.children?.length ?? merge.mindMap?.children?.length ?? 0;
    mindMapLog(
      `[agent-mindmap] M3 root trie ok: ${allReal.length} session(s), ${topCount} top-level branch(es)`
    );
    return merge;
  } catch (err) {
    mindMapLog(
      `[agent-mindmap] M3 root trie failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    throw err;
  }
}

async function rebuildParentChain(
  leafId: string,
  manifest: SnapshotManifest,
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<void> {
  let childId = leafId;
  let parent = findParentNode(manifest, childId);

  while (parent) {
    const siblings = parent.childIds
      .map((id) => manifest.nodes.find((n) => n.id === id))
      .filter((n): n is SnapshotNode => Boolean(n));

    if (siblings.length !== parent.childIds.length) {
      throw new Error(
        `[agent-mindmap] Parent ${parent.id} references missing child snapshots`
      );
    }

    progress?.report(`M-merge (L${parent.level}): refreshing ${parent.id}…`);
    const { snapshot, node } = await mergeSnapshotGroup(
      siblings,
      parent.level,
      parent.id,
      opts,
      progress
    );

    const idx = manifest.nodes.findIndex((n) => n.id === parent!.id);
    manifest.nodes[idx] = node;
    await writeSnapshotByPath(
      opts.storeDir,
      opts.projectSlug,
      node.path,
      snapshot
    );
    await writeSnapshotManifest(opts.storeDir, manifest);

    childId = parent.id;
    parent = findParentNode(manifest, childId);
  }
}

/**
 * Rebuild L1 for changed session and cascade up to root + M3.
 */
export async function refreshSnapshotForSession(
  opts: SnapshotHierarchyLlmOpts & { sessionId: string },
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const manifest = await ensureManifest(
    opts.storeDir,
    opts.projectSlug,
    opts.groupSize
  );
  const leaf = findLeafNodeForSession(manifest, opts.sessionId);
  if (!leaf) {
    throw new Error(
      `[agent-mindmap] No L1 snapshot covers session ${opts.sessionId}; run batch analyze first`
    );
  }

  const batchRecords = leaf.sessionIds
    .map((id) => opts.allRecords.find((r) => r.meta.sessionId === id))
    .filter((r): r is SessionRecord => Boolean(r));

  if (batchRecords.length !== leaf.sessionIds.length) {
    throw new Error(
      `[agent-mindmap] Missing library records for leaf ${leaf.id} sessions`
    );
  }

  await runLeafSnapshotMerge(
    {
      ...opts,
      batchRecords,
      batchNo: parseInt(leaf.id.replace(/^l1-/, ""), 10) || 1,
      existingLeafId: leaf.id,
    },
    progress
  );

  const refreshedManifest = (await readSnapshotManifest(
    opts.storeDir,
    opts.projectSlug
  ))!;

  if (findParentNode(refreshedManifest, leaf.id)) {
    await rebuildParentChain(leaf.id, refreshedManifest, opts, progress);
  }

  const afterChain =
    (await readSnapshotManifest(opts.storeDir, opts.projectSlug)) ??
    refreshedManifest;
  await promoteAllLevels(afterChain, opts, progress);

  return rebuildProjectRoot(opts, progress);
}

/**
 * Batch analyze hook: L1 → promote → root + M3.
 */
export async function runBatchSnapshotPipeline(
  opts: RunBatchSnapshotPipelineOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  try {
    await runLeafSnapshotMerge(opts, progress);
  } catch (err) {
    throw wrapHierarchyError("L1 leaf merge", err);
  }

  const manifest = await readSnapshotManifest(opts.storeDir, opts.projectSlug);
  if (!manifest) {
    throw new Error(
      "[agent-mindmap] runBatchSnapshotPipeline: manifest missing after L1 merge"
    );
  }

  try {
    await promoteAllLevels(manifest, opts, progress);
  } catch (err) {
    throw wrapHierarchyError("snapshot promotion", err);
  }

  let merge: MergeRecord;
  try {
    merge = await rebuildProjectRoot(opts, progress);
  } catch (err) {
    throw wrapHierarchyError("root rebuild + M3", err);
  }

  await writeMergeRecord(conceptTrieMergePath(opts.storeDir), merge);
  return merge;
}

function wrapHierarchyError(stage: string, err: unknown): Error {
  const detail = err instanceof Error ? err.message : String(err);
  return new Error(`[agent-mindmap] ${stage} failed: ${detail}`, {
    cause: err instanceof Error ? err : undefined,
  });
}

/** DET-only root refresh (no M-merge LLM). */
export async function runFinalRootRefresh(
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const root = await readMergeSnapshot(opts.storeDir, opts.projectSlug);
  const allReal = filterRealSessionRecords(opts.allRecords);
  if (!root) {
    return rebuildProjectRoot(opts, progress);
  }

  progress?.report("Final DET refresh of concept trie…");
  const merge = await updateConceptTrieAsync({
    records: allReal,
    segmentEquivalences: root.segmentEquivalences,
    virtualSessionAnalysis: root.sessionAnalysis,
    projectSlug: opts.projectSlug,
  });
  await writeMergeSnapshot(opts.storeDir, root);
  return merge;
}
