import type { LlmProviderOptions, LlmProvider } from "../llm/types";
import type { ConceptMergeLlmOpts } from "../store/conceptMergeContext";
import type { ProjectMergeMode } from "../pipeline/deltaMergePipeline";
import type { MindMapProgress } from "../progress";
import { buildConceptMergeForRecords } from "../store/conceptMergeContext";
import { runBatchSnapshotPipeline } from "../pipeline/snapshotHierarchy";
import { filterRealSessionRecords } from "../store/mergeSnapshot";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import type { SessionRecord } from "../store/storeTypes";
import type { MergeRecord } from "../store/storeTypes";
import { t } from "../l10n/uiTranslate";

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
  const sanitized = await Promise.all(
    records.map((r) => sanitizeSessionRecord(r))
  );
  const { merge } = await buildConceptMergeForRecords(sanitized, {
    storeDir,
    projectSlug,
    llm: llmOpts,
    provider,
    signal,
    progress,
    forceReattach,
    ontologyFlags: forceReattach ? { forceRefine: true } : undefined,
  });
  return merge;
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
  const sanitizedAll = await Promise.all(
    filterRealSessionRecords(allRecords).map((r) => sanitizeSessionRecord(r))
  );
  const sanitizedBatch = await Promise.all(
    filterRealSessionRecords(batchRecords).map((r) => sanitizeSessionRecord(r))
  );
  if (!opts.batchRefineOntology) {
    return buildProjectConceptMergeFromCache(
      storeDir,
      sanitizedAll,
      opts.conceptLlm,
      opts.projectSlug,
      opts.provider,
      opts.signal,
      opts.progress,
      false
    );
  }
  if (opts.processed !== undefined && opts.total !== undefined) {
    opts.progress?.report(
      t(
        "ui.batch.progress.refineOntology",
        "Refining concept synonyms (batch {0}, {1}/{2} sessions)…",
        opts.batchNo,
        opts.processed,
        opts.total
      )
    );
  } else {
    opts.progress?.report(
      t(
        "ui.ontology.refine.heartbeat",
        "Refining concept segment equivalences…"
      )
    );
  }
  return runBatchSnapshotPipeline(
    {
      storeDir,
      projectSlug: opts.projectSlug,
      allRecords: sanitizedAll,
      batchRecords: sanitizedBatch,
      batchNo: opts.batchNo,
      provider: opts.provider,
      providerId: opts.conceptLlm.providerId,
      model: opts.conceptLlm.model,
      hostId: opts.conceptLlm.hostId,
      promptLanguage: opts.conceptLlm.promptLanguage,
      llmTimeoutMs: opts.conceptLlm.timeoutMs,
      signal: opts.signal,
      forceReattach: opts.forceReattach ?? true,
    },
    opts.progress
  );
}
