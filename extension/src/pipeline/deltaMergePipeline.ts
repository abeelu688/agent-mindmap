import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
import type { MindMapProgress } from "../progress";
import {
  batchIntroducesNewTopRoots,
  buildMergeSnapshotFromOntology,
  filterRealSessionRecords,
  MERGE_SNAPSHOT_SESSION_ID,
  readMergeSnapshot,
  snapshotToSessionRecord,
  writeMergeSnapshot,
} from "../store/mergeSnapshot";
import type { MergeRecord, MergeSnapshot, SessionRecord } from "../store/storeTypes";
import { runMergePipeline, type MergePipelineResult } from "./mergePipeline";

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

export function shouldFullReconcile(
  opts: RunDeltaMergePipelineOpts,
  snapshot: MergeSnapshot | undefined,
  allRecords: SessionRecord[]
): boolean {
  if (opts.mergeMode === "full" || opts.forceRefresh) {
    return true;
  }
  if (!snapshot) {
    return true;
  }
  /** First batch milestone must not reuse delta against a stale snapshot file. */
  if (opts.batchNo <= 1) {
    return true;
  }
  if (!snapshotCoversCurrentSessions(snapshot, allRecords)) {
    return true;
  }
  const every = Math.max(1, opts.mergeFullReconcileEvery);
  return opts.batchNo % every === 0;
}

/**
 * Delta batch merge: LLM on [virtual snapshot + new batch]; M3 on all real sessions.
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
  const useDelta =
    opts.mergeMode === "delta" &&
    snapshot != null &&
    !fullReconcile;

  let llmRecords: SessionRecord[];
  let existingReattachSteps = snapshot?.reattachSteps;

  if (useDelta && snapshot) {
    llmRecords = [snapshotToSessionRecord(snapshot), ...batchReal];
    progress?.report(
      `M-merge (delta): project snapshot + ${batchReal.length} new session(s)…`
    );
  } else {
    llmRecords = allReal;
    if (fullReconcile) {
      existingReattachSteps = undefined;
    }
    progress?.report(
      fullReconcile && opts.batchNo > 1
        ? "M-merge (full reconcile): all sessions…"
        : "M-merge (full): all sessions…"
    );
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
      existingReattachSteps,
      signal: opts.signal,
    },
    provider,
    progress
  );

  let mergeModeUsed: ProjectMergeMode = useDelta ? "delta" : "full";
  let finalResult = result;
  const stepsBefore = existingReattachSteps?.length ?? 0;
  const stepsAfterDelta = result.ontology.reattachSteps?.length ?? 0;
  const needFullFallback =
    useDelta &&
    snapshot != null &&
    stepsAfterDelta <= stepsBefore &&
    batchIntroducesNewTopRoots(snapshot, batchReal);

  if (needFullFallback) {
    progress?.report(
      "M-merge: delta produced no new merge steps; re-merging all sessions…"
    );
    finalResult = await runMergePipeline(
      {
        storeDir: opts.storeDir,
        records: allReal,
        llmRecords: allReal,
        projectSlug: opts.projectSlug,
        model: opts.model,
        hostId: opts.hostId,
        providerId: opts.providerId,
        promptLanguage: opts.promptLanguage,
        refineMode: "batch",
        incrementalFromIndex: true,
        forceReattach: true,
        mergeMode: "full",
        existingReattachSteps:
          result.ontology.reattachSteps ?? existingReattachSteps,
        signal: opts.signal,
      },
      provider,
      progress
    );
    mergeModeUsed = "full";
  }

  const snap = buildMergeSnapshotFromOntology(
    allReal,
    finalResult.ontology,
    finalResult.merge,
    opts.projectSlug
  );
  await writeMergeSnapshot(opts.storeDir, snap);

  return {
    ...finalResult,
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
  const snap = buildMergeSnapshotFromOntology(
    allReal,
    result.ontology,
    result.merge,
    projectSlug
  );
  await writeMergeSnapshot(storeDir, snap);
  return result.merge;
}
