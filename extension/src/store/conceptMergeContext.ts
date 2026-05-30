import type { AgentHostId } from "../host/types";
import type { LlmProvider, SegmentEquivalence } from "../llm/types";
import type { MindMapProgress } from "../progress";
import { runMergePipeline, type MergeRefineMode } from "../pipeline/mergePipeline";
import { collectMergeTerms } from "../pipeline/stages/collectMergeTerms";
import {
  collectSessionSegmentEquivalences,
  enhanceSegmentEquivalencesForMerge,
} from "../llm/synonymHintDerive";
import { applyTopicPathsFromOntology } from "./applyOntology";
import {
  buildConceptMergeRecord,
  buildConceptMergeRecordAsync,
  type ConceptMergeOptions,
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

function recordsMatchOntologySessions(
  records: SessionRecord[],
  ontology: ConceptOntologyRecord
): boolean {
  const recordIds = new Set(records.map((r) => r.meta.sessionId));
  const ontologyIds = ontology.meta.sessionIds;
  if (recordIds.size !== ontologyIds.length) {
    return false;
  }
  return ontologyIds.every((id) => recordIds.has(id));
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
    const collected = collectMergeTerms(records);
    const fallback = enhanceSegmentEquivalencesForMerge(
      collected.topicPaths,
      collected.nodes,
      collectSessionSegmentEquivalences(records)
    );
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
    return { segmentEquivalences: cached.segmentEquivalences };
  }

  const collected = collectMergeTerms(records);
  const fallback = enhanceSegmentEquivalencesForMerge(
    collected.topicPaths,
    collected.nodes,
    collectSessionSegmentEquivalences(records)
  );
  if (fallback.length) {
    return { segmentEquivalences: fallback };
  }

  return {};
}

export function prepareRecordsForConceptMerge(
  records: SessionRecord[],
  ctx: LoadedConceptMergeContext
): SessionRecord[] {
  if (!ctx.ontology || !recordsMatchOntologySessions(records, ctx.ontology)) {
    return records;
  }
  return applyTopicPathsFromOntology(records, ctx.ontology);
}

export function buildConceptMergeWithOntology(
  records: SessionRecord[],
  options: ConceptMergeOptions = {},
  ctx: LoadedConceptMergeContext = {}
): MergeRecord {
  const enriched = prepareRecordsForConceptMerge(records, ctx);
  return buildConceptMergeRecord(enriched, {
    ...options,
    segmentEquivalences:
      options.segmentEquivalences ?? ctx.segmentEquivalences,
  });
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
  const enriched = prepareRecordsForConceptMerge(
    await Promise.all(records.map((r) => sanitizeSessionRecord(r))),
    ctx
  );
  return buildConceptMergeRecordAsync(enriched, {
    ...options,
    segmentEquivalences:
      options.segmentEquivalences ?? ctx.segmentEquivalences,
  });
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
