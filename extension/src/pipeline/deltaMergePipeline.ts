import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
import type { MindMapProgress } from "../progress";
import {
  batchIntroducesNewTopRoots,
  buildMergeSnapshotFromOntology,
  buildMergeSnapshotFromVirtualSession,
  filterRealSessionRecords,
  MERGE_SNAPSHOT_SESSION_ID,
  readMergeSnapshot,
  snapshotToSessionRecord,
  writeMergeSnapshot,
} from "../store/mergeSnapshot";
import type { MergeRecord, MergeSnapshot, SessionRecord } from "../store/storeTypes";
import { runMergePipeline, type MergePipelineResult } from "./mergePipeline";
import { finalizeSessionAnalysis } from "./stages/finalizeSessionAnalysis";

export type ProjectMergeMode = "full" | "delta";

export type RunDeltaMergePipelineOpts = {
  storeDir: string;
  projectSlug: string;
  allRecords: SessionRecord[];
  batchRecords: SessionRecord[];
  batchNo: number;
  mergeMode: ProjectMergeMode;
  mergeFullReconcileEvery: number;
  forceRefresh?: boolean;
  model?: string;
  hostId?: AgentHostId;
  providerId: string;
  promptLanguage?: "zh" | "en";
  signal: AbortSignal;
  forceReattach?: boolean;
  /** Base CLI timeout (ms); passed to M-merge. */
  llmTimeoutMs?: number;
};

export type RunDeltaMergePipelineResult = MergePipelineResult & {
  mergeModeUsed: ProjectMergeMode;
};

/** Snapshot session set must be a subset of current library (no orphan/stale snapshot). */
export function snapshotCoversCurrentSessions(
  snapshot: MergeSnapshot,
  allRecords: SessionRecord[]
): boolean {
  const current = new Set(allRecords.map((r) => r.meta.sessionId));
  const snapIds = snapshot.meta.sessionIds;
  if (snapIds.length > current.size) {
    return false;
  }
  return snapIds.every((id) => current.has(id));
}

/** True only for batch 1 milestone (no prior snapshot to delta from). */
export function shouldFullReconcile(
  opts: RunDeltaMergePipelineOpts,
  _snapshot: MergeSnapshot | undefined,
  _allRecords: SessionRecord[]
): boolean {
  return opts.batchNo <= 1;
}

/**
 * Delta batch merge: LLM on [virtual snapshot + new batch]; M3 on all real sessions.
 * See .cursor/rules/merge-snapshot-delta.mdc — never widen LLM input to allReal on delta.
 */
export async function runDeltaMergePipeline(
  opts: RunDeltaMergePipelineOpts,
  provider: LlmProvider,
  progress?: MindMapProgress
): Promise<RunDeltaMergePipelineResult> {
  const allReal = filterRealSessionRecords(opts.allRecords);
  const batchReal = filterRealSessionRecords(opts.batchRecords);

  const snapshot = await readMergeSnapshot(opts.storeDir, opts.projectSlug);
  const fullReconcile = shouldFullReconcile(opts, snapshot, allReal);
  const useDelta = opts.batchNo > 1 && snapshot != null;
  const batchNewTopRoots = snapshot
    ? batchIntroducesNewTopRoots(snapshot, batchReal)
    : false;

  // #region agent log
  fetch("http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0cd37d",
    },
    body: JSON.stringify({
      sessionId: "0cd37d",
      runId: "post-fix-v10",
      hypothesisId: "H1-H2",
      location: "deltaMergePipeline.ts:entry",
      message: "delta merge batch decision",
      data: {
        batchNo: opts.batchNo,
        allSessionCount: allReal.length,
        batchSessionCount: batchReal.length,
        mergeMode: opts.mergeMode,
        fullReconcile,
        useDelta,
        snapshotSessionCount: snapshot?.meta.sessionIds.length ?? 0,
        batchNewTopRoots,
        mergeFullReconcileEvery: opts.mergeFullReconcileEvery,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  let llmRecords: SessionRecord[];

  if (useDelta && snapshot) {
    llmRecords = [snapshotToSessionRecord(snapshot), ...batchReal];
    progress?.report(
      `M-merge (delta): project snapshot + ${batchReal.length} new session(s)…`
    );
  } else if (opts.batchNo > 1 && !snapshot) {
    llmRecords = batchReal;
    progress?.report(
      `M-merge (batch-only): no snapshot yet; merging ${batchReal.length} new session(s)…`
    );
  } else {
    llmRecords = allReal;
    progress?.report("M-merge (full): first batch milestone sessions…");
  }

  const result = await runMergePipeline(
    {
      storeDir: opts.storeDir,
      records: allReal,
      llmRecords,
      projectSlug: opts.projectSlug,
      model: opts.model,
      hostId: opts.hostId,
      providerId: opts.providerId,
      promptLanguage: opts.promptLanguage,
      refineMode: "batch",
      incrementalFromIndex: true,
      forceReattach: opts.forceReattach ?? true,
      mergeMode: useDelta ? "delta" : "full",
      snapshotSessionId: useDelta ? MERGE_SNAPSHOT_SESSION_ID : undefined,
      llmTimeoutMs: opts.llmTimeoutMs,
      signal: opts.signal,
    },
    provider,
    progress
  );

  const mergeModeUsed: ProjectMergeMode = useDelta ? "delta" : "full";

  // #region agent log
  fetch("http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "0cd37d",
    },
    body: JSON.stringify({
      sessionId: "0cd37d",
      runId: "post-fix-v10",
      hypothesisId: "H1-H4",
      location: "deltaMergePipeline.ts:postMerge",
      message: "delta merge virtual session outcome",
      data: {
        batchNo: opts.batchNo,
        mergeModeUsed,
        mergeLlmRan: result.reattachLlmStepCount ?? 0,
        hasVirtualSession: Boolean(result.virtualSession),
        batchNewTopRoots,
        topLevelCount: result.uiTopLevelCount,
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const virtualSession =
    result.virtualSession ??
    (result.ontology.mergeSessionAnalysis
      ? finalizeSessionAnalysis(result.ontology.mergeSessionAnalysis, {
          sessionId: MERGE_SNAPSHOT_SESSION_ID,
          projectSlug: opts.projectSlug,
          userQueryCount: 0,
        })
      : undefined);

  const snap = virtualSession
    ? buildMergeSnapshotFromVirtualSession(
        allReal,
        virtualSession,
        opts.projectSlug,
        result.ontology.segmentEquivalences ?? []
      )
    : buildMergeSnapshotFromOntology(
        allReal,
        result.ontology,
        result.merge,
        opts.projectSlug
      );
  await writeMergeSnapshot(opts.storeDir, snap);

  return {
    ...result,
    mergeModeUsed,
  };
}

/** DET-only final pass: refresh snapshot + trie without M-merge LLM. */
export async function runFinalSnapshotRefresh(
  storeDir: string,
  allRecords: SessionRecord[],
  projectSlug: string,
  provider: LlmProvider,
  opts: {
    model?: string;
    hostId?: AgentHostId;
    providerId: string;
    signal: AbortSignal;
  },
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const allReal = filterRealSessionRecords(allRecords);
  const result = await runMergePipeline(
    {
      storeDir,
      records: allReal,
      projectSlug,
      model: opts.model,
      hostId: opts.hostId,
      providerId: opts.providerId,
      refineMode: "skip",
      incrementalFromIndex: true,
      forceReattach: false,
      signal: opts.signal,
    },
    provider,
    progress
  );
  const virtualSession =
    result.virtualSession ??
    (result.ontology.mergeSessionAnalysis
      ? finalizeSessionAnalysis(result.ontology.mergeSessionAnalysis, {
          sessionId: MERGE_SNAPSHOT_SESSION_ID,
          projectSlug,
          userQueryCount: 0,
        })
      : undefined);
  const snap = virtualSession
    ? buildMergeSnapshotFromVirtualSession(
        allReal,
        virtualSession,
        projectSlug,
        result.ontology.segmentEquivalences ?? []
      )
    : buildMergeSnapshotFromOntology(
        allReal,
        result.ontology,
        result.merge,
        projectSlug
      );
  await writeMergeSnapshot(storeDir, snap);
  return result.merge;
}
