import type { AgentHostId } from "../host/types";
import type { LlmProvider } from "../llm/types";
import type { MindMapProgress } from "../progress";
import {
  filterRealSessionRecords,
  readSnapshotManifest,
} from "../store/mergeSnapshot";
import type { MergeRecord, MergeSnapshot, SessionRecord } from "../store/storeTypes";
import type { MergePipelineResult } from "./mergePipeline";
import {
  runBatchSnapshotPipeline,
  runFinalRootRefresh,
  type SnapshotHierarchyLlmOpts,
} from "./snapshotHierarchy";

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

/**
 * @deprecated Hierarchy merge always uses bounded L1 full merge; batchNo no longer drives full reconcile.
 */
export function shouldFullReconcile(
  opts: RunDeltaMergePipelineOpts,
  _snapshot: MergeSnapshot | undefined,
  _allRecords: SessionRecord[]
): boolean {
  return opts.batchNo <= 1;
}

function hierarchyOpts(
  opts: RunDeltaMergePipelineOpts,
  provider: LlmProvider
): SnapshotHierarchyLlmOpts & RunDeltaMergePipelineOpts {
  return {
    ...opts,
    provider,
  };
}

/**
 * Multi-level snapshot batch merge: L1 per batch → promote → root + M3.
 */
export async function runDeltaMergePipeline(
  opts: RunDeltaMergePipelineOpts,
  provider: LlmProvider,
  progress?: MindMapProgress
): Promise<RunDeltaMergePipelineResult> {
  const allReal = filterRealSessionRecords(opts.allRecords);
  const batchReal = filterRealSessionRecords(opts.batchRecords);

  const merge = await runBatchSnapshotPipeline(
    {
      ...hierarchyOpts(opts, provider),
      allRecords: allReal,
      batchRecords: batchReal,
      batchNo: opts.batchNo,
    },
    progress
  );

  return {
    merge,
    ontology: {
      schemaVersion: 1,
      meta: {
        builtAt: Date.now(),
        cacheKey: "",
        sessionIds: allReal.map((r) => r.meta.sessionId),
        projectSlugs: [opts.projectSlug],
        llm: { provider: opts.providerId, model: opts.model },
        promptVersions: {
          ontology: 0,
          topicPaths: 0,
          reattach: 0,
          refine: 0,
          outlineSchema: 0,
          sessionAnalysis: 0,
          mergeSessionAnalysis: 0,
        },
      },
      nodes: [],
      mappings: [],
    },
    records: allReal,
    mergeModeUsed: "full",
  };
}

/** DET-only final pass: refresh root trie without M-merge LLM. */
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
  return runFinalRootRefresh(
    {
      storeDir,
      projectSlug,
      allRecords: allReal,
      provider,
      providerId: opts.providerId,
      model: opts.model,
      hostId: opts.hostId,
      signal: opts.signal,
    },
    progress
  );
}

/** True when multi-level snapshot manifest exists for the project. */
export async function hasSnapshotHierarchy(
  storeDir: string,
  projectSlug: string
): Promise<boolean> {
  return (await readSnapshotManifest(storeDir, projectSlug)) != null;
}
