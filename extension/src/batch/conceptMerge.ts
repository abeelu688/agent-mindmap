/**
 * Extension adapter for concept merge — delegates to core and injects
 * extension-specific dependencies (store resolution, sanitize, locale,
 * conceptMergeContext).
 */
import {
  resolveProjectRecordsForMerge as coreResolveProjectRecordsForMerge,
  buildProjectConceptMergeFromCache as coreBuildProjectConceptMergeFromCache,
  buildProjectConceptMergeForBatch as coreBuildProjectConceptMergeForBatch,
  refreshSnapshotsForFreshSessions as coreRefreshSnapshotsForFreshSessions,
  toConceptMergeLlmOpts as coreToConceptMergeLlmOpts,
  type ConceptMergeLlmOpts,
  type ProjectMergeMode,
  type ConceptMergeDeps,
} from "@agent-mindmap/core";
import { buildConceptMergeForRecords } from "../store/conceptMergeContext";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import { getStoreForDir } from "../store/storeClient";
import { t } from "../l10n/uiTranslate";
import type { LlmProviderOptions, LlmProvider } from "@agent-mindmap/core";
import type { MindMapProgress } from "../progress";
import type { SessionRecord } from "../store/storeTypes";
import type { MergeRecord } from "../store/storeTypes";

// Re-export types for backward compatibility.
export type { ConceptMergeLlmOpts, ProjectMergeMode };

/** Build the extension-specific deps object for core concept merge functions. */
async function buildConceptMergeDeps(storeDir: string): Promise<ConceptMergeDeps> {
  const store = await getStoreForDir(storeDir);
  return {
    store,
    sanitizeRecord: sanitizeSessionRecord,
    buildConceptMergeForRecordsFn: buildConceptMergeForRecords,
    localeResolver: {
      t(key: string, fallback: string, ...args: unknown[]): string {
        return t(key, fallback, ...(args as Array<string | number | boolean>));
      },
    },
  };
}

/** Local library records for merge, with in-memory batch overlay winning on conflict. */
export async function resolveProjectRecordsForMerge(
  storeDir: string,
  projectSlug: string,
  overlayById: Map<string, SessionRecord>
): Promise<SessionRecord[]> {
  const store = await getStoreForDir(storeDir);
  return coreResolveProjectRecordsForMerge(store, projectSlug, overlayById);
}

export function toConceptMergeLlmOpts(
  llmOpts: LlmProviderOptions,
  providerId: string
): ConceptMergeLlmOpts {
  return {
    model: llmOpts.model,
    hostId: llmOpts.hostId,
    providerId,
    timeoutMs: llmOpts.timeoutMs,
  };
}

export async function buildProjectConceptMergeFromCache(
  storeDir: string,
  records: SessionRecord[],
  llmOpts: ConceptMergeLlmOpts,
  projectSlug: string | undefined,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress,
  forceReattach = false
): Promise<MergeRecord> {
  const deps = await buildConceptMergeDeps(storeDir);
  return coreBuildProjectConceptMergeFromCache(
    deps,
    storeDir,
    records,
    llmOpts,
    projectSlug,
    provider,
    signal,
    progress,
    forceReattach
  );
}

export async function buildProjectConceptMergeForBatch(
  storeDir: string,
  allRecords: SessionRecord[],
  batchRecords: SessionRecord[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    batchRefineOntology: boolean;
    batchNo: number;
    processed?: number;
    total?: number;
    forceReattach?: boolean;
    mergeMode: ProjectMergeMode;
    mergeFullReconcileEvery: number;
    forceRefresh?: boolean;
  }
): Promise<MergeRecord> {
  const deps = await buildConceptMergeDeps(storeDir);
  return coreBuildProjectConceptMergeForBatch(deps, storeDir, allRecords, batchRecords, opts);
}

/**
 * Per-session incremental snapshot update: for each session whose transcript
 * changed in this batch, refresh only its L1 leaf and cascade up the parent
 * chain to the project root. Sessions without an existing leaf in the
 * manifest fall back to a fresh L1 batch via the core snapshotHierarchy.
 *
 * Returns the latest concept-trie {@link MergeRecord} after all updates, or
 * `undefined` when there is nothing to do (no fresh sessions and no first-
 * time merge needed).
 */
export async function refreshSnapshotsForFreshSessions(
  storeDir: string,
  allRecords: SessionRecord[],
  freshSessionIds: string[],
  opts: {
    projectSlug: string;
    conceptLlm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    llmTimeoutMs?: number;
  }
): Promise<MergeRecord | undefined> {
  const deps = await buildConceptMergeDeps(storeDir);
  return coreRefreshSnapshotsForFreshSessions(deps, storeDir, allRecords, freshSessionIds, opts);
}
