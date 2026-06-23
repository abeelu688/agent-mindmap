/**
 * Extension adapter for snapshotHierarchy — resolves Store via getStoreForDir,
 * injects sanitizeSessionRecord, extensionLlmDumpDeps, and tryReuseBatchMerge.
 */
import {
  runLeafSnapshotMerge as coreRunLeafSnapshotMerge,
  runBatchSnapshotPipeline as coreRunBatchSnapshotPipeline,
  rebuildProjectRoot as coreRebuildProjectRoot,
  refreshSnapshotForSession as coreRefreshSnapshotForSession,
  runFinalRootRefresh as coreRunFinalRootRefresh,
  type SnapshotHierarchyLlmOpts as CoreSnapshotHierarchyLlmOpts,
  type TryReuseBatchMergeFn,
  type SanitizeRecordFn,
} from "@agent-mindmap/core";
import { getStoreForDir } from "../store/storeClient";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import { extensionLlmDumpDeps } from "../llm/llmIoDumpAdapter";
import { tryReuseBatchMerge } from "./batchMergeCache";
import type { MindMapProgress } from "../progress";
import type { MergeRecord, MergeSnapshot, SessionRecord } from "../store/storeTypes";
import type { Store } from "@agent-mindmap/shared";

// Re-export core-only types that are not overridden by the adapter.
export type { TryReuseBatchMergeFn, SanitizeRecordFn } from "@agent-mindmap/core";

/**
 * Extension-facing opts mirror the old API: storeDir instead of store.
 * The adapter resolves the store and injects extension-specific callbacks.
 */
export type SnapshotHierarchyLlmOpts = Omit<
  CoreSnapshotHierarchyLlmOpts,
  "store" | "sanitizeRecord" | "dumpDeps" | "tryReuseBatchMergeFn"
> & { storeDir: string };

export type RunLeafSnapshotMergeOpts = SnapshotHierarchyLlmOpts & {
  batchRecords: SessionRecord[];
  batchNo: number;
  existingLeafId?: string;
};

export type RunBatchSnapshotPipelineOpts = SnapshotHierarchyLlmOpts & {
  batchRecords: SessionRecord[];
  batchNo: number;
};

function toCoreOpts(
  opts: SnapshotHierarchyLlmOpts,
  store: Store
): CoreSnapshotHierarchyLlmOpts {
  return {
    ...opts,
    store,
    sanitizeRecord: sanitizeSessionRecord as SanitizeRecordFn,
    dumpDeps: extensionLlmDumpDeps,
    tryReuseBatchMergeFn: tryReuseBatchMerge as TryReuseBatchMergeFn,
  };
}

export async function runLeafSnapshotMerge(
  opts: RunLeafSnapshotMergeOpts,
  progress?: MindMapProgress
): Promise<{ leafId: string; snapshot: MergeSnapshot }> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRunLeafSnapshotMerge(
    {
      ...toCoreOpts(opts, store),
      batchRecords: opts.batchRecords,
      batchNo: opts.batchNo,
      existingLeafId: opts.existingLeafId,
    },
    progress
  );
}

export async function rebuildProjectRoot(
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRebuildProjectRoot(toCoreOpts(opts, store), progress);
}

export async function refreshSnapshotForSession(
  opts: SnapshotHierarchyLlmOpts & { sessionId: string },
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRefreshSnapshotForSession(
    { ...toCoreOpts(opts, store), sessionId: opts.sessionId },
    progress
  );
}

export async function runBatchSnapshotPipeline(
  opts: RunBatchSnapshotPipelineOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRunBatchSnapshotPipeline(
    {
      ...toCoreOpts(opts, store),
      batchRecords: opts.batchRecords,
      batchNo: opts.batchNo,
    },
    progress
  );
}

export async function runFinalRootRefresh(
  opts: SnapshotHierarchyLlmOpts,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRunFinalRootRefresh(toCoreOpts(opts, store), progress);
}
