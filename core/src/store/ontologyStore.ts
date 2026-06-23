/**
 * Cross-session concept ontology store — cache management and incremental builds.
 *
 * Moved from extension/src/store/ontologyStore.ts in R3.1.
 * Uses Store injection, LocalizedStringResolver, and ProgressReporter
 * instead of getStoreForDir / uiTranslate / MindMapProgress.
 */
import { ONTOLOGY_PROMPT_VERSION } from "../llm/promptOntology";
import { TOPIC_PATHS_PROMPT_VERSION } from "../llm/promptTopicPaths";
import { MERGE_SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptMergeSessionAnalysis";
import { REATTACH_PROMPT_VERSION } from "../llm/promptReattach";
import { OUTLINE_PROMPT_VERSION } from "../llm/promptOutline";
import { collectMergeTerms } from "../pipeline/stages/collectMergeTerms";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import {
  collectSessionSegmentEquivalences,
  mergeSegmentEquivalencesLists,
} from "../llm/synonymHintDerive";
import { sha256Hex } from "../crypto";
import { recordFreshnessToken } from "./sessionStore";
import type { OutputLanguage, PromptLanguage } from "../llm/promptLanguage";
import type { SessionRecord } from "@agent-mindmap/shared";
import type { OntologyRecord, OntologyRecordTopicPath } from "@agent-mindmap/shared";
import type { ProgressReporter } from "../ports/ProgressReporter";
import type { LocalizedStringResolver } from "../ports/LocalizedStringResolver";
import type { LlmProvider } from "../llm/types";
import type { AgentHostId } from "../host/types";
import type { Store } from "@agent-mindmap/shared";

export type OntologyIndex = {
  schemaVersion: 1;
  updatedAt: number;
  entries: {
    cacheKey: string;
    builtAt: number;
    sessionIds: string[];
    projectSlugs: string[];
  }[];
};

export type EnsureOntologyMemoryFlags = {
  /** Re-run refine even when cache is complete; do not return early on cache hit. */
  forceRefine?: boolean;
  /** Reuse nodes/mappings from the latest subset ontology cache in index.json. */
  incrementalFromIndex?: boolean;
  /** Skip extract and topicPaths; only run refine (final pass). */
  refineOnly?: boolean;
};

function sessionIdsSubsetOf(subset: string[], superset: string[]): boolean {
  const set = new Set(superset);
  return subset.every((id) => set.has(id));
}

export async function readOntologyIndex(store: Store): Promise<OntologyIndex | undefined> {
  return store.readOntologyIndex();
}

/**
 * Latest ontology cache for the same project whose sessions are a subset of
 * the current selection (for incremental nodes/mappings reuse).
 */
export async function findReusableOntologyBase(
  store: Store,
  records: SessionRecord[]
): Promise<OntologyRecord | undefined> {
  if (!records.length) {
    return undefined;
  }
  const currentSessionIds = records.map((r) => r.meta.sessionId);
  const projectSlugs = new Set(records.map((r) => r.meta.projectSlug));
  const index = await readOntologyIndex(store);
  if (!index?.entries.length) {
    return undefined;
  }
  const candidates = index.entries
    .filter(
      (e) =>
        e.sessionIds.length > 0 &&
        e.projectSlugs.some((s) => projectSlugs.has(s)) &&
        sessionIdsSubsetOf(e.sessionIds, currentSessionIds)
    )
    .sort((a, b) => b.builtAt - a.builtAt);
  for (const entry of candidates) {
    const cached = await readOntologyRecord(store, entry.cacheKey);
    if (cached?.nodes?.length && cached.mappings) {
      return cached;
    }
  }
  return undefined;
}

function filterTopicPathsForSessions(
  topicPaths: OntologyRecordTopicPath[],
  sessionIds: Set<string>
): OntologyRecordTopicPath[] {
  return topicPaths.filter((p) => sessionIds.has(p.sessionId));
}

function projectSlugsFor(records: SessionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.meta.projectSlug))).sort();
}

export function computeOntologyCacheKey(
  records: SessionRecord[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    promptLanguage?: PromptLanguage;
    outputLanguage?: OutputLanguage;
  },
  providerId: string
): string {
  const sorted = [...records].sort((a, b) => a.meta.sessionId.localeCompare(b.meta.sessionId));
  const payload = JSON.stringify({
    sessionIds: sorted.map((r) => r.meta.sessionId),
    transcriptTokens: sorted.map((r) => recordFreshnessToken(r)),
    provider: providerId,
    model: opts.model?.trim() || "",
    hostId: opts.hostId ?? sorted[0]?.meta.hostId ?? "cursor",
    outputLanguage: opts.outputLanguage ?? sorted[0]?.meta.outputLanguage ?? "Chinese",
    promptVersions: {
      ontology: ONTOLOGY_PROMPT_VERSION,
      topicPaths: TOPIC_PATHS_PROMPT_VERSION,
      reattach: REATTACH_PROMPT_VERSION,
      outlineSchema: OUTLINE_PROMPT_VERSION,
      sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
    },
  });
  return sha256Hex(payload);
}

export async function readOntologyRecord(
  store: Store,
  cacheKey: string
): Promise<OntologyRecord | undefined> {
  return store.readOntologyRecord(cacheKey);
}

async function writeOntologyIndex(
  store: Store,
  entry: OntologyIndex["entries"][number]
): Promise<void> {
  const parsed = (await store.readOntologyIndex()) ?? {
    schemaVersion: 1,
    updatedAt: Date.now(),
    entries: [],
  };
  const next: OntologyIndex = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    entries: [entry, ...parsed.entries.filter((e) => e.cacheKey !== entry.cacheKey)].slice(0, 200),
  };
  await store.writeOntologyIndex(next);
}

/** Remove all cached ontology records (forces rebuild on next Concept merge). */
export async function clearOntologyCache(store: Store): Promise<void> {
  await store.clearOntologyCache();
}

export function isCompleteOntologyRecord(record: OntologyRecord): boolean {
  return (
    record.nodes.length > 0 &&
    record.topicPaths.length > 0 &&
    record.meta.promptVersions.sessionAnalysis === SESSION_ANALYSIS_PROMPT_VERSION &&
    record.meta.promptVersions.reattach === REATTACH_PROMPT_VERSION &&
    record.segmentEquivalences !== undefined
  );
}

export async function writeOntologyRecord(
  store: Store,
  cacheKey: string,
  records: SessionRecord[],
  hostId: AgentHostId,
  opts: {
    model?: string;
    hostId?: AgentHostId;
  },
  provider: LlmProvider,
  payload: Pick<
    OntologyRecord,
    | "nodes"
    | "mappings"
    | "topicPaths"
    | "reattachMoves"
    | "reattachSteps"
    | "segmentEquivalences"
    | "mergeSessionAnalysis"
  >
): Promise<OntologyRecord> {
  const record: OntologyRecord = {
    schemaVersion: 1,
    meta: {
      builtAt: Date.now(),
      cacheKey,
      sessionIds: records.map((r) => r.meta.sessionId),
      projectSlugs: projectSlugsFor(records),
      llm: { provider: provider.id, model: opts.model?.trim() || undefined },
      promptVersions: {
        ontology: ONTOLOGY_PROMPT_VERSION,
        topicPaths: TOPIC_PATHS_PROMPT_VERSION,
        reattach: REATTACH_PROMPT_VERSION,
        refine: 0,
        outlineSchema: OUTLINE_PROMPT_VERSION,
        sessionAnalysis: SESSION_ANALYSIS_PROMPT_VERSION,
        mergeSessionAnalysis: MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
      },
      hostId,
    },
    nodes: payload.nodes,
    mappings: payload.mappings,
    topicPaths: payload.topicPaths,
    reattachMoves: payload.reattachMoves,
    reattachSteps: payload.reattachSteps,
    segmentEquivalences: payload.segmentEquivalences,
    mergeSessionAnalysis: payload.mergeSessionAnalysis,
  };
  await store.writeOntologyRecord(cacheKey, record);
  await writeOntologyIndex(store, {
    cacheKey,
    builtAt: record.meta.builtAt,
    sessionIds: record.meta.sessionIds,
    projectSlugs: record.meta.projectSlugs,
  });
  return record;
}

/**
 * Build (or reuse) a cross-session concept ontology + per-topic conceptPath memory.
 */
export async function ensureOntologyMemory(
  records: SessionRecord[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    title?: string;
    promptLanguage?: PromptLanguage;
  },
  provider: LlmProvider,
  store: Store,
  signal: AbortSignal,
  progress?: ProgressReporter,
  localeResolver?: LocalizedStringResolver,
  flags: EnsureOntologyMemoryFlags = {}
): Promise<OntologyRecord> {
  const t = localeResolver?.t ?? ((_key: string, fallback: string) => fallback);

  progress?.report(t("ui.ontology.cache.check", "Checking concept ontology cache…"));
  const cacheKey = computeOntologyCacheKey(records, opts, provider.id);
  const cached = await readOntologyRecord(store, cacheKey);
  if (cached && isCompleteOntologyRecord(cached) && !flags.forceRefine && !flags.refineOnly) {
    progress?.report(t("ui.ontology.cache.hit", "Concept ontology cache hit…"));
    return cached;
  }

  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const currentSessionIds = new Set(records.map((r) => r.meta.sessionId));

  const reusableBase = flags.incrementalFromIndex
    ? await findReusableOntologyBase(store, records)
    : undefined;

  let nodes = cached?.nodes ?? reusableBase?.nodes;
  let mappings = cached?.mappings ?? reusableBase?.mappings;
  const reattachMoves = cached?.reattachMoves ?? reusableBase?.reattachMoves;
  let topicPaths = filterTopicPathsForSessions(
    cached?.topicPaths ?? reusableBase?.topicPaths ?? [],
    currentSessionIds
  );

  if (flags.refineOnly) {
    if (!nodes?.length || !mappings) {
      const collected = collectMergeTerms(records, reusableBase);
      nodes = collected.nodes;
      mappings = collected.mappings;
      topicPaths = collected.topicPaths;
    }
    if (!nodes?.length || !mappings) {
      throw new Error("ontology refine-only requires existing nodes/mappings in cache");
    }
    const segmentEquivalences = mergeSegmentEquivalencesLists(
      collectSessionSegmentEquivalences(records)
    );
    return writeOntologyRecord(store, cacheKey, records, hostId, opts, provider, {
      nodes,
      mappings,
      topicPaths,
      reattachMoves,
      segmentEquivalences,
    });
  }

  progress?.report(t("ui.ontology.extract", "Collecting concept terms…"));
  const collected = collectMergeTerms(records, reusableBase);
  nodes = collected.nodes;
  mappings = collected.mappings;
  topicPaths = collected.topicPaths;

  let segmentEquivalences: OntologyRecord["segmentEquivalences"];
  if (flags.forceRefine || cached?.segmentEquivalences === undefined) {
    segmentEquivalences = mergeSegmentEquivalencesLists(
      reusableBase?.segmentEquivalences ?? [],
      collectSessionSegmentEquivalences(records)
    );
  } else {
    segmentEquivalences = cached!.segmentEquivalences;
  }

  return writeOntologyRecord(store, cacheKey, records, hostId, opts, provider, {
    nodes: nodes!,
    mappings: mappings!,
    topicPaths,
    reattachMoves,
    segmentEquivalences,
  });
}
