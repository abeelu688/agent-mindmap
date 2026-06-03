import type { AgentHostId } from "../host/types";
import type { LlmProvider, SegmentEquivalence } from "../llm/types";
import type { MindMapProgress } from "../progress";
import { runMergePipeline, type MergeRefineMode } from "../pipeline/mergePipeline";
import { collectMergeTerms } from "../pipeline/stages/collectMergeTerms";
import {
  collectSessionSegmentEquivalences,
  enhanceSegmentEquivalencesForMerge,
} from "../llm/synonymHintDerive";
import { REATTACH_PROMPT_VERSION } from "../llm/promptReattach";
import { segmentKeyForMerge } from "../llm/topicGraphValidate";
import { MERGE_APPLY_SEGMENT_EQUIVALENCES, MERGE_DERIVE_SEGMENT_EQUIVALENCES } from "../pipeline/mergeSynonymPolicy";
import {
  ontologySliceForPrep,
  prepareRecordsForFinalTrie,
  recordsSubsetOfOntologySessions,
} from "./prepareConceptMergeRecords";
import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
  type ConceptMergeOptions,
  type ConceptMergePrepOntology,
} from "./mergeConceptTrie";
import type { ConceptOntologyRecord } from "./ontologyTypes";
import {
  computeOntologyCacheKey,
  isCompleteOntologyRecord,
  readOntologyIndex,
  readOntologyRecord,
  type EnsureOntologyMemoryFlags,
} from "./ontologyStore";
import type { MergeRecord, SessionRecord } from "./storeTypes";

export type ConceptMergeLlmOpts = {
  model?: string;
  hostId?: AgentHostId;
  providerId: string;
  promptLanguage?: "zh" | "en";
  timeoutMs?: number;
};

export type LoadedConceptMergeContext = {
  segmentEquivalences?: SegmentEquivalence[];
  /** Full ontology when cache key matches exactly (enables topicPaths apply). */
  ontology?: ConceptOntologyRecord;
};

function sessionIdsSubsetOf(
  subset: string[],
  superset: string[]
): boolean {
  const set = new Set(superset);
  return subset.every((id) => set.has(id));
}

function ontologyPrepSliceForRecords(
  ctx: LoadedConceptMergeContext,
  records: SessionRecord[]
): ConceptMergePrepOntology | undefined {
  const ont = ctx.ontology;
  if (!ont) {
    return undefined;
  }
  if (!recordsSubsetOfOntologySessions(records, ont)) {
    return undefined;
  }
  if (ont.meta.promptVersions.reattach !== REATTACH_PROMPT_VERSION) {
    return undefined;
  }
  const hasPrep =
    (ont.topicPaths?.length ?? 0) > 0 ||
    (ont.reattachSteps?.length ?? 0) > 0 ||
    (ont.reattachMoves?.length ?? 0) > 0;
  if (!hasPrep) {
    return undefined;
  }
  return ontologySliceForPrep(ont, records);
}

function mergeOptionsWithContext(
  records: SessionRecord[],
  options: ConceptMergeOptions,
  ctx: LoadedConceptMergeContext
): ConceptMergeOptions {
  const ontologyForPrep = ontologyPrepSliceForRecords(ctx, records);
  return {
    ...options,
    ontologyForPrep: ontologyForPrep ?? options.ontologyForPrep,
    segmentEquivalences:
      options.segmentEquivalences ?? ctx.segmentEquivalences,
    applySegmentEquivalences:
      options.applySegmentEquivalences ?? MERGE_APPLY_SEGMENT_EQUIVALENCES,
    recordsAlreadyPrepared: options.recordsAlreadyPrepared ?? false,
  };
}

function fallbackSegmentEquivalences(
  records: SessionRecord[]
): SegmentEquivalence[] {
  const sessionEquivalences = collectSessionSegmentEquivalences(records);
  if (!MERGE_DERIVE_SEGMENT_EQUIVALENCES) {
    return sessionEquivalences;
  }
  const collected = collectMergeTerms(records);
  return enhanceSegmentEquivalencesForMerge(
    collected.topicPaths,
    collected.nodes,
    sessionEquivalences
  );
}

/**
 * Load segment equivalences from ontology cache (exact key, then reusable subset).
 */
export async function loadSegmentEquivalencesForRecords(
  storeDir: string,
  records: SessionRecord[],
  llmOpts: ConceptMergeLlmOpts
): Promise<LoadedConceptMergeContext> {
  if (!records.length) {
    return {};
  }

  const cacheKey = computeOntologyCacheKey(
    records,
    { model: llmOpts.model, hostId: llmOpts.hostId },
    llmOpts.providerId
  );
  const exact = await readOntologyRecord(storeDir, cacheKey);
  if (exact && isCompleteOntologyRecord(exact)) {
    return {
      segmentEquivalences: exact.segmentEquivalences,
      ontology: exact,
    };
  }

  const currentSessionIds = records.map((r) => r.meta.sessionId);
  const projectSlugs = new Set(records.map((r) => r.meta.projectSlug));
  const index = await readOntologyIndex(storeDir);
  if (!index?.entries.length) {
    const fallback = fallbackSegmentEquivalences(records);
    if (fallback.length) {
      return { segmentEquivalences: fallback };
    }
    return {};
  }

  const candidates = index.entries
    .filter(
      (e) =>
        e.projectSlugs.some((s) => projectSlugs.has(s)) &&
        sessionIdsSubsetOf(e.sessionIds, currentSessionIds)
    )
    .sort((a, b) => b.builtAt - a.builtAt);

  for (const entry of candidates) {
    const cached = await readOntologyRecord(storeDir, entry.cacheKey);
    if (!cached || !isCompleteOntologyRecord(cached)) {
      continue;
    }
    if (!cached.segmentEquivalences?.length) {
      continue;
    }
    return {
      segmentEquivalences: cached.segmentEquivalences,
      ontology: cached,
    };
  }

  const fallback = fallbackSegmentEquivalences(records);
  if (fallback.length) {
    return { segmentEquivalences: fallback };
  }

  return {};
}

/** Distinct first-segment roots across all topic conceptPaths. */
export function countDistinctTopRoots(records: SessionRecord[]): number {
  const roots = new Set<string>();
  for (const record of records) {
    for (const topic of record.graph.topics) {
      const key = segmentKeyForMerge(topic.conceptPath?.[0] ?? "");
      if (key) {
        roots.add(key);
      }
    }
  }
  return roots.size;
}

/** Cached ontology has topicPaths + M2.5 output when multiple parallel roots exist. */
export function isOntologyReadyForConceptMerge(
  ctx: LoadedConceptMergeContext,
  records: SessionRecord[]
): boolean {
  const ont = ctx.ontology;
  if (!ont?.topicPaths?.length) {
    return false;
  }
  if (!recordsSubsetOfOntologySessions(records, ont)) {
    return false;
  }
  if (!isCompleteOntologyRecord(ont)) {
    return false;
  }
  if (ont.meta.promptVersions.reattach !== REATTACH_PROMPT_VERSION) {
    return false;
  }
  if (countDistinctTopRoots(records) < 2) {
    return true;
  }
  return (
    (ont.reattachSteps?.length ?? 0) > 0 ||
    (ont.reattachMoves?.length ?? 0) > 0
  );
}

/**
 * Build concept mind map: reuse complete ontology cache, otherwise run full M1–M3 pipeline.
 */
export async function buildConceptMergeForRecords(
  records: SessionRecord[],
  opts: {
    storeDir: string;
    projectSlug?: string;
    llm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    forceReattach?: boolean;
    ontologyFlags?: EnsureOntologyMemoryFlags;
  }
): Promise<{ merge: MergeRecord; ctx: LoadedConceptMergeContext }> {
  const ctx = await loadSegmentEquivalencesForRecords(
    opts.storeDir,
    records,
    opts.llm
  );
  const ontologyReady = isOntologyReadyForConceptMerge(ctx, records);

  if (ontologyReady && !opts.forceReattach) {
    return {
      merge: buildConceptMergeWithOntology(
        records,
        opts.projectSlug ? { projectSlug: opts.projectSlug } : {},
        ctx
      ),
      ctx,
    };
  }

  return ensureOntologyAndBuildConceptMerge(records, {
    storeDir: opts.storeDir,
    projectSlug: opts.projectSlug,
    llm: opts.llm,
    provider: opts.provider,
    signal: opts.signal,
    progress: opts.progress,
    ontologyFlags: opts.ontologyFlags ?? { forceRefine: true },
    forceReattach: opts.forceReattach ?? true,
  });
}

export function prepareRecordsForConceptMerge(
  records: SessionRecord[],
  ctx: LoadedConceptMergeContext
): SessionRecord[] {
  const ontologyForPrep = ontologyPrepSliceForRecords(ctx, records);
  if (!ontologyForPrep) {
    return records;
  }
  return prepareRecordsForFinalTrie(
    records,
    ontologyForPrep,
    ctx.ontology?.reattachMoves,
    ctx.ontology?.reattachSteps
  );
}

export function buildConceptMergeWithOntology(
  records: SessionRecord[],
  options: ConceptMergeOptions = {},
  ctx: LoadedConceptMergeContext = {}
): MergeRecord {
  return buildConceptMergeRecord(
    records,
    mergeOptionsWithContext(records, options, ctx)
  );
}

export async function resolveAndBuildConceptMergeAsync(
  storeDir: string,
  records: SessionRecord[],
  options: ConceptMergeOptions,
  llmOpts: ConceptMergeLlmOpts
): Promise<MergeRecord> {
  const ctx = await loadSegmentEquivalencesForRecords(
    storeDir,
    records,
    llmOpts
  );
  const { sanitizeSessionRecord } = await import("./sanitizeRecords");
  const sanitized = await Promise.all(
    records.map((r) => sanitizeSessionRecord(r))
  );
  return buildConceptMergeRecordAsync(
    sanitized,
    mergeOptionsWithContext(sanitized, options, ctx)
  );
}

function flagsToRefineMode(flags: EnsureOntologyMemoryFlags): MergeRefineMode {
  if (flags.refineOnly) {
    return "final";
  }
  if (flags.forceRefine) {
    return "batch";
  }
  return "skip";
}

export async function ensureOntologyAndBuildConceptMerge(
  records: SessionRecord[],
  opts: {
    storeDir: string;
    projectSlug?: string;
    llm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    ontologyFlags?: EnsureOntologyMemoryFlags;
    cacheDir?: string;
    cacheLlm?: boolean;
    forceReattach?: boolean;
  }
): Promise<{ merge: MergeRecord; ctx: LoadedConceptMergeContext }> {
  const flags = opts.ontologyFlags ?? {};
  const result = await runMergePipeline(
    {
      storeDir: opts.storeDir,
      records,
      projectSlug: opts.projectSlug,
      model: opts.llm.model,
      hostId: opts.llm.hostId,
      providerId: opts.llm.providerId,
      promptLanguage: opts.llm.promptLanguage,
      refineMode: flagsToRefineMode(flags),
      incrementalFromIndex: flags.incrementalFromIndex,
      forceReattach: opts.forceReattach,
      cacheDir: opts.cacheDir,
      cacheLlm: opts.cacheLlm,
      signal: opts.signal,
    },
    opts.provider,
    opts.progress
  );
  const ctx: LoadedConceptMergeContext = {
    segmentEquivalences: result.ontology.segmentEquivalences,
    ontology: result.ontology,
  };
  return { merge: result.merge, ctx };
}

/** Batch / new-session: incremental nodes/mappings + cross-session synonym merge. */
export async function ensureIncrementalOntologyAndBuildConceptMerge(
  records: SessionRecord[],
  opts: {
    storeDir: string;
    projectSlug?: string;
    llm: ConceptMergeLlmOpts;
    provider: LlmProvider;
    signal: AbortSignal;
    progress?: MindMapProgress;
    refineOnly?: boolean;
    cacheDir?: string;
    cacheLlm?: boolean;
  }
): Promise<{ merge: MergeRecord; ctx: LoadedConceptMergeContext }> {
  return ensureOntologyAndBuildConceptMerge(records, {
    ...opts,
    ontologyFlags: opts.refineOnly
      ? { refineOnly: true, forceRefine: true }
      : { incrementalFromIndex: true, forceRefine: true },
  });
}
