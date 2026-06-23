/**
 * M-merge pipeline: ontology cache → concept merge LLM → concept trie.
 *
 * Moved from extension/src/pipeline/mergePipeline.ts in R2.4.
 * Uses Store injection, ProgressReporter, sanitizeRecord and LlmDumpDeps ports.
 */
import {
  computeOntologyCacheKey,
  findReusableOntologyBase,
  readOntologyRecord,
  writeOntologyRecord,
} from "../store/ontologyStore";
import { buildOutlineFromConceptTrie } from "../store/mergeConceptTrie";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import {
  collectSessionSegmentEquivalences,
  mergeSegmentEquivalencesLists,
} from "../llm/synonymHintDerive";
import { buildTrieReparentInput, type MergeInputMode } from "../llm/trieReparentInput";
import { MERGE_SNAPSHOT_SESSION_ID } from "../store/mergeSnapshot";
import { outputLanguageFromRecords } from "../llm/outputLanguageFromRecords";
import { collectMergeTerms } from "../pipeline/stages/collectMergeTerms";
import {
  mergeSessionAnalysis,
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
} from "../pipeline/stages/mergeSessionAnalysis";
import { prepareRecordsBeforeReattach, updateConceptTrieAsync } from "../pipeline/stages/updateConceptTrie";
import { createPipelineTimingCollector } from "../pipeline/pipelineTiming";
import {
  finalizeSessionAnalysis,
  type FinalizedSessionAnalysis,
} from "../pipeline/stages/finalizeSessionAnalysis";
import type { AgentHostId } from "../host/types";
import type { LlmProvider, SessionAnalysis } from "../llm/types";
import type { OutputLanguage } from "../llm/promptLanguage";
import type { ProgressReporter } from "../ports/ProgressReporter";
import type { OntologyRecord } from "@agent-mindmap/shared";
import type { MergeRecord, SessionRecord } from "@agent-mindmap/shared";
import type { MindMapRoot } from "../transcript/types";
import type { Store } from "@agent-mindmap/shared";
import type { LlmDumpDeps } from "../ports/LlmDumpDeps";

export type MergeRefineMode = "batch" | "final" | "skip";

export type MergePipelineOpts = {
  store: Store;
  /** All real sessions — M3 trie + ontology sessionIds. */
  records: SessionRecord[];
  /** Subset for M-merge LLM (defaults to records). */
  llmRecords?: SessionRecord[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  providerId: string;
  outputLanguage?: OutputLanguage;
  refineMode?: MergeRefineMode;
  /** Reuse nodes/mappings from latest subset ontology cache. */
  incrementalFromIndex?: boolean;
  cacheDir?: string;
  cacheLlm?: boolean;
  signal: AbortSignal;
  skipTiming?: boolean;
  /** Batch milestone: always run M-merge even when ontology cache has mergeSessionAnalysis. */
  forceReattach?: boolean;
  mergeMode?: MergeInputMode;
  snapshotSessionId?: string;
  /** Base CLI timeout (ms); passed to M-merge. */
  llmTimeoutMs?: number;
  /** Skip M3 trie build (L1 / promotion merges only). */
  skipM3?: boolean;
  /** Sanitize callback — extension injects host-specific transcript parser. */
  sanitizeRecord?: (record: SessionRecord) => Promise<SessionRecord>;
  /** LLM dump deps — extension injects VS Code-backed dump adapter. */
  dumpDeps?: LlmDumpDeps;
};

export type MergePipelineResult = {
  merge: MergeRecord;
  ontology: OntologyRecord;
  records: SessionRecord[];
  /** M-merge ran (1) or skipped (0). */
  reattachLlmStepCount?: number;
  uiTopLevelCount?: number;
  /** M-merge virtual combined session when LLM or cache produced one. */
  virtualSession?: FinalizedSessionAnalysis;
};

export function mindMapTopLevelCount(merge: MergeRecord): number {
  const children = merge.mindMap?.nodeData?.children ?? merge.mindMap?.children ?? [];
  return children.length;
}

function sessionSegmentEquivalences(records: SessionRecord[]) {
  return collectSessionSegmentEquivalences(records);
}

function enhancedOntologyCacheKey(
  records: SessionRecord[],
  opts: Pick<MergePipelineOpts, "model" | "hostId" | "providerId" | "outputLanguage">
): string {
  const base = computeOntologyCacheKey(
    records,
    { model: opts.model, hostId: opts.hostId, outputLanguage: opts.outputLanguage },
    opts.providerId
  );
  const stageVersions = [
    SESSION_ANALYSIS_PROMPT_VERSION,
    MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
  ].join("-");
  return `${base}-v${stageVersions}`;
}

/** Same cache key formula used by runMergePipeline; exported for batchMergeCache short-circuit. */
export function computeBatchMergeCacheKey(
  records: SessionRecord[],
  opts: {
    model?: string;
    hostId?: AgentHostId;
    providerId: string;
    outputLanguage?: OutputLanguage;
  }
): string {
  return enhancedOntologyCacheKey(records, opts);
}

export async function runMergePipeline(
  opts: MergePipelineOpts,
  provider: LlmProvider,
  progress?: ProgressReporter
): Promise<MergePipelineResult> {
  const refineMode = opts.refineMode ?? "batch";
  const llmRecords = opts.llmRecords ?? opts.records;
  const outputLanguage = opts.outputLanguage ?? outputLanguageFromRecords(llmRecords);
  const cacheKey = enhancedOntologyCacheKey(opts.records, {
    model: opts.model,
    hostId: opts.hostId,
    providerId: opts.providerId,
    outputLanguage,
  });

  const timing = opts.skipTiming
    ? undefined
    : createPipelineTimingCollector(
        "merge",
        {
          projectSlug: opts.projectSlug,
          sessionCount: opts.records.length,
          refineMode,
        },
        undefined // storeDir not available in core timing
      );

  const runStage = async <T>(
    stage: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown> | (() => Record<string, unknown>)
  ): Promise<T> => {
    if (timing) {
      return timing.time(stage, fn, meta);
    }
    return fn();
  };

  const baseOntology = opts.incrementalFromIndex
    ? await findReusableOntologyBase(opts.store, opts.records)
    : undefined;

  progress?.report("M1: Collecting terms with context…");
  const collected = await runStage("M1 collectTerms", async () =>
    collectMergeTerms(opts.records, baseOntology)
  );

  const cached = await readOntologyRecord(opts.store, cacheKey);
  const sessionEquivalences = sessionSegmentEquivalences(opts.records);

  let segmentEquivalences = await runStage(
    "M2 sessionEquivalences",
    async () => {
      if (refineMode === "skip" && cached?.segmentEquivalences?.length) {
        return cached.segmentEquivalences;
      }
      return mergeSegmentEquivalencesLists(
        baseOntology?.segmentEquivalences ?? [],
        sessionEquivalences
      );
    },
    () => ({ kind: "det" })
  );

  let virtualSession: FinalizedSessionAnalysis | undefined;
  let reattachLlmStepCount: number | undefined;
  const llmCollected = await runStage("M1 collectTerms (llm)", async () =>
    collectMergeTerms(llmRecords, baseOntology)
  );

  const recordsForMergeInput = prepareRecordsBeforeReattach(llmRecords, {
    nodes: llmCollected.nodes,
    mappings: llmCollected.mappings,
    topicPaths: llmCollected.topicPaths,
    segmentEquivalences,
  });
  const allRecordsForReparent = prepareRecordsBeforeReattach(opts.records, {
    nodes: collected.nodes,
    mappings: collected.mappings,
    topicPaths: collected.topicPaths,
    segmentEquivalences,
  });
  const allReparentInput = buildTrieReparentInput(allRecordsForReparent, {
    segmentEquivalences,
    ontologyNodes: collected.nodes,
    topicPaths: collected.topicPaths,
    projectSlug: opts.projectSlug,
  });

  const hasCachedVirtual = Boolean(cached?.mergeSessionAnalysis);
  const mergeAnalysisVersionStale =
    cached != null &&
    cached.meta.promptVersions.mergeSessionAnalysis !== MERGE_SESSION_ANALYSIS_PROMPT_VERSION;
  const llmInputCount = recordsForMergeInput.length;
  const needsConceptMerge =
    llmInputCount >= 2 &&
    (opts.forceReattach ||
      mergeAnalysisVersionStale ||
      refineMode === "batch" ||
      refineMode === "final" ||
      !hasCachedVirtual);

  if (needsConceptMerge) {
    progress?.report("M-merge: LLM virtual combined session (session-analysis schema)…");
    const finalized = await runStage(
      "M-merge conceptMerge",
      () =>
        mergeSessionAnalysis(
          {
            records: llmRecords,
            segmentEquivalences,
            ontologyNodes: llmCollected.nodes,
            topicPaths: llmCollected.topicPaths,
            ontologyMappings: llmCollected.mappings,
            projectSlug: opts.projectSlug,
            model: opts.model,
            hostId: opts.hostId,
            mergeMode: opts.mergeMode,
            snapshotSessionId: opts.snapshotSessionId,
            outputLanguage,
            llmTimeoutMs: opts.llmTimeoutMs,
          },
          provider,
          opts.signal,
          progress,
          opts.dumpDeps
        ),
      () => ({ kind: "llm" })
    );
    if (finalized) {
      virtualSession = finalized;
      reattachLlmStepCount = 1;
      segmentEquivalences = mergeSegmentEquivalencesLists(
        segmentEquivalences,
        finalized.sessionSynonyms.segmentEquivalences ?? []
      );
    } else {
      reattachLlmStepCount = 0;
    }
  } else if (cached?.mergeSessionAnalysis) {
    progress?.report("M-merge: Virtual session cache hit…");
    const cachedAnalysis = cached.mergeSessionAnalysis;
    if (!cachedAnalysis.outline) {
      cachedAnalysis.outline = buildOutlineFromConceptTrie(
        cachedAnalysis.domains,
        cachedAnalysis.nodes
      );
    }
    virtualSession = finalizeSessionAnalysis(cachedAnalysis, {
      sessionId: MERGE_SNAPSHOT_SESSION_ID,
      projectSlug: opts.projectSlug ?? opts.records[0]?.meta.projectSlug ?? "",
      userQueryCount: 0,
    });
    await runStage(
      "M-merge conceptMerge",
      async () => virtualSession,
      () => ({
        kind: "llm",
        cacheHit: true,
        skipped: true,
      })
    );
  }

  const virtualAnalysis: SessionAnalysis | undefined = virtualSession?.sessionAnalysis;
  const ontologyNodes = virtualAnalysis?.nodes?.length ? virtualAnalysis.nodes : collected.nodes;

  const ontologyPayload = {
    nodes: ontologyNodes,
    mappings: collected.mappings,
    topicPaths: collected.topicPaths,
    segmentEquivalences,
    mergeSessionAnalysis: virtualAnalysis,
  };

  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const ontology = await runStage(
    "M2b writeOntology",
    () =>
      writeOntologyRecord(
        opts.store,
        cacheKey,
        opts.records,
        hostId,
        { model: opts.model, hostId: opts.hostId },
        provider,
        ontologyPayload
      ),
    () => ({ kind: "io" })
  );

  let merge: MergeRecord;
  if (opts.skipM3) {
    merge = {
      schemaVersion: 1,
      meta: {
        kind: "llm-refined",
        builtAt: Date.now(),
        sessionIds: opts.records.map((r) => r.meta.sessionId),
        projectSlugs: opts.projectSlug
          ? [opts.projectSlug]
          : [...new Set(opts.records.map((r) => r.meta.projectSlug))],
      },
      mindMap: { nodeData: { data: { text: "root" } } } as unknown as MindMapRoot,
    };
  } else {
    progress?.report("M3: Updating concept trie…");
    merge = await runStage(
      "M3 updateTrie",
      () =>
        updateConceptTrieAsync({
          records: opts.records,
          segmentEquivalences,
          virtualSessionAnalysis: ontology.mergeSessionAnalysis,
          ontology,
          projectSlug: opts.projectSlug,
          sanitizeRecord: opts.sanitizeRecord,
        }),
      () => ({ kind: "det" })
    );
  }

  const mindMapChildren = merge.mindMap?.nodeData?.children ?? merge.mindMap?.children ?? [];

  await timing?.finish();

  return {
    merge,
    ontology,
    records: opts.records,
    reattachLlmStepCount,
    uiTopLevelCount: mindMapChildren.length,
    virtualSession,
  };
}
