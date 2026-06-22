import { t as safeT } from "../l10n/uiTranslate";
import { ONTOLOGY_PROMPT_VERSION } from "@agent-mindmap/core";
import { TOPIC_PATHS_PROMPT_VERSION } from "@agent-mindmap/core";
import { MERGE_SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptMergeSessionAnalysis";
import { REATTACH_PROMPT_VERSION } from "../llm/promptReattach";
import { OUTLINE_PROMPT_VERSION } from "@agent-mindmap/core";
import { collectMergeTerms } from "../pipeline/stages/collectMergeTerms";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "@agent-mindmap/core";
import {
  collectSessionSegmentEquivalences,
  mergeSegmentEquivalencesLists,
} from "@agent-mindmap/core";
import { recordFreshnessToken, sha256Hex } from "./sessionStore";
import { getStoreForDir } from "./storeClient";
import type { OutputLanguage, PromptLanguage } from "@agent-mindmap/core";
import type { SessionRecord } from "./storeTypes";
import type { ConceptOntologyRecord, TopicConceptPathDecision } from "./ontologyTypes";
import type { MindMapProgress } from "../progress";
import type { LlmProvider } from "@agent-mindmap/core";
import type { AgentHostId } from "@agent-mindmap/core";

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

export async function readOntologyIndex(storeDir: string): Promise<OntologyIndex | undefined> {
  const store = await getStoreForDir(storeDir);
  return store.readOntologyIndex();
}

/**
 * Latest ontology cache for the same project whose sessions are a subset of
 * the current selection (for incremental nodes/mappings reuse).
 */
export async function findReusableOntologyBase(
  storeDir: string,
  records: SessionRecord[]
): Promise<ConceptOntologyRecord | undefined> {
  if (!records.length) {
    return undefined;
  }
  const currentSessionIds = records.map((r) => r.meta.sessionId);
  const projectSlugs = new Set(records.map((r) => r.meta.projectSlug));
  const index = await readOntologyIndex(storeDir);
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
    const cached = await readOntologyRecord(storeDir, entry.cacheKey);
    if (cached?.nodes?.length && cached.mappings) {
      return cached;
    }
  }
  return undefined;
}

function filterTopicPathsForSessions(
  topicPaths: TopicConceptPathDecision[],
  sessionIds: Set<string>
): TopicConceptPathDecision[] {
  return topicPaths.filter((p) => sessionIds.has(p.sessionId));
}

function sessionIdsWithTopicPaths(topicPaths: TopicConceptPathDecision[]): Set<string> {
  return new Set(topicPaths.map((p) => p.sessionId));
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
  storeDir: string,
  cacheKey: string
): Promise<ConceptOntologyRecord | undefined> {
  const store = await getStoreForDir(storeDir);
  return store.readOntologyRecord(cacheKey);
}

async function writeOntologyIndex(
  storeDir: string,
  entry: OntologyIndex["entries"][number]
): Promise<void> {
  const store = await getStoreForDir(storeDir);
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
export async function clearOntologyCache(storeDir: string): Promise<void> {
  const store = await getStoreForDir(storeDir);
  await store.clearOntologyCache();
}

export function isCompleteOntologyRecord(record: ConceptOntologyRecord): boolean {
  return (
    record.nodes.length > 0 &&
    record.topicPaths.length > 0 &&
    record.meta.promptVersions.sessionAnalysis === SESSION_ANALYSIS_PROMPT_VERSION &&
    record.meta.promptVersions.reattach === REATTACH_PROMPT_VERSION &&
    record.segmentEquivalences !== undefined
  );
}

export async function writeOntologyRecord(
  storeDir: string,
  cacheKey: string,
  records: SessionRecord[],
  hostId: AgentHostId,
  opts: {
    model?: string;
    hostId?: AgentHostId;
  },
  provider: LlmProvider,
  payload: Pick<
    ConceptOntologyRecord,
    | "nodes"
    | "mappings"
    | "topicPaths"
    | "reattachMoves"
    | "reattachSteps"
    | "segmentEquivalences"
    | "mergeSessionAnalysis"
  >
): Promise<ConceptOntologyRecord> {
  const record: ConceptOntologyRecord = {
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
  await (await getStoreForDir(storeDir)).writeOntologyRecord(cacheKey, record);
  await writeOntologyIndex(storeDir, {
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
  storeDir: string,
  signal: AbortSignal,
  progress?: MindMapProgress,
  flags: EnsureOntologyMemoryFlags = {}
): Promise<ConceptOntologyRecord> {
  // bootstrapStore() (via getStoreForDir) creates the DB + store dir on first
  // access, so there is no need for an explicit ensureStore() call here.
  progress?.report(safeT("ui.ontology.cache.check", "Checking concept ontology cache…"));
  const cacheKey = computeOntologyCacheKey(records, opts, provider.id);
  const cached = await readOntologyRecord(storeDir, cacheKey);
  if (cached && isCompleteOntologyRecord(cached) && !flags.forceRefine && !flags.refineOnly) {
    progress?.report(safeT("ui.ontology.cache.hit", "Concept ontology cache hit…"));
    return cached;
  }

  const hostId = opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const currentSessionIds = new Set(records.map((r) => r.meta.sessionId));

  const reusableBase = flags.incrementalFromIndex
    ? await findReusableOntologyBase(storeDir, records)
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
    return writeOntologyRecord(storeDir, cacheKey, records, hostId, opts, provider, {
      nodes,
      mappings,
      topicPaths,
      reattachMoves,
      segmentEquivalences,
    });
  }

  progress?.report(safeT("ui.ontology.extract", "Collecting concept terms…"));
  const collected = collectMergeTerms(records, reusableBase);
  nodes = collected.nodes;
  mappings = collected.mappings;
  topicPaths = collected.topicPaths;

  let segmentEquivalences: ConceptOntologyRecord["segmentEquivalences"];
  if (flags.forceRefine || cached?.segmentEquivalences === undefined) {
    segmentEquivalences = mergeSegmentEquivalencesLists(
      reusableBase?.segmentEquivalences ?? [],
      collectSessionSegmentEquivalences(records)
    );
  } else {
    segmentEquivalences = cached!.segmentEquivalences;
  }

  return writeOntologyRecord(storeDir, cacheKey, records, hostId, opts, provider, {
    nodes: nodes!,
    mappings: mappings!,
    topicPaths,
    reattachMoves,
    segmentEquivalences,
  });
}
