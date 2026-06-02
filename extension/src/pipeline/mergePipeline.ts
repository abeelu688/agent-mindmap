import type { AgentHostId } from "../host/types";
import type { LlmProvider, ReattachStep } from "../llm/types";
import type { MindMapProgress } from "../progress";
import {
  computeOntologyCacheKey,
  findReusableOntologyBase,
  readOntologyRecord,
  writeOntologyRecord,
} from "../store/ontologyStore";
import type { ConceptOntologyRecord } from "../store/ontologyTypes";
import type { MergeRecord, SessionRecord } from "../store/storeTypes";
import { collectMergeTerms } from "./stages/collectMergeTerms";
import { mergeTrieReparent } from "./stages/mergeTrieReparent";
import {
  prepareRecordsBeforeReattach,
  updateConceptTrieAsync,
} from "./stages/updateConceptTrie";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import { dumpLlmReplay } from "../llm/llmIoDump";
import {
  buildReattachPrompt,
  REATTACH_PROMPT_VERSION,
} from "../llm/promptReattach";
import {
  collectSessionSegmentEquivalences,
  mergeSegmentEquivalencesLists,
} from "../llm/segmentContext";
import { appendReattachSteps } from "../store/mergeSnapshot";
import {
  inferPrefixSubordinateSteps,
  reattachStepsToMoves,
} from "../llm/reattachSteps";
import { buildTrieReparentInput, type MergeInputMode } from "../llm/trieReparentInput";
import { createPipelineTimingCollector } from "./pipelineTiming";

export type MergeRefineMode = "batch" | "final" | "skip";

export type MergePipelineOpts = {
  storeDir: string;
  /** All real sessions — M3 trie + ontology sessionIds. */
  records: SessionRecord[];
  /** Subset for M-merge LLM (defaults to records). */
  llmRecords?: SessionRecord[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  providerId: string;
  promptLanguage?: "zh" | "en";
  refineMode?: MergeRefineMode;
  /** Reuse nodes/mappings from latest subset ontology cache. */
  incrementalFromIndex?: boolean;
  cacheDir?: string;
  cacheLlm?: boolean;
  signal: AbortSignal;
  skipTiming?: boolean;
  /** Batch milestone: always run M-merge even when ontology cache has reattachMoves. */
  forceReattach?: boolean;
  mergeMode?: MergeInputMode;
  snapshotSessionId?: string;
  /** Prior reattach steps (delta); new LLM steps are appended. */
  existingReattachSteps?: ReattachStep[];
};

export type MergePipelineResult = {
  merge: MergeRecord;
  ontology: ConceptOntologyRecord;
  records: SessionRecord[];
};

function sessionSegmentEquivalences(records: SessionRecord[]) {
  return collectSessionSegmentEquivalences(records);
}

function enhancedOntologyCacheKey(
  records: SessionRecord[],
  opts: Pick<MergePipelineOpts, "model" | "hostId" | "providerId">
): string {
  const base = computeOntologyCacheKey(
    records,
    { model: opts.model, hostId: opts.hostId },
    opts.providerId
  );
  const stageVersions = [
    SESSION_ANALYSIS_PROMPT_VERSION,
    REATTACH_PROMPT_VERSION,
  ].join(":");
  return `${base}:${stageVersions}`;
}

export async function runMergePipeline(
  opts: MergePipelineOpts,
  provider: LlmProvider,
  progress?: MindMapProgress
): Promise<MergePipelineResult> {
  const refineMode = opts.refineMode ?? "batch";
  const llmRecords = opts.llmRecords ?? opts.records;
  const cacheKey = enhancedOntologyCacheKey(opts.records, {
    model: opts.model,
    hostId: opts.hostId,
    providerId: opts.providerId,
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
        opts.storeDir
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
    ? await findReusableOntologyBase(opts.storeDir, opts.records)
    : undefined;

  progress?.report("M1: Collecting terms with context…");
  const collected = await runStage("M1 collectTerms", async () =>
    collectMergeTerms(opts.records, baseOntology)
  );

  const cached = await readOntologyRecord(opts.storeDir, cacheKey);
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

  let reattachMoves = cached?.reattachMoves;
  let reattachSteps: ReattachStep[] | undefined = cached?.reattachSteps;
  const ontologyForReparent = {
    nodes: collected.nodes,
    mappings: collected.mappings,
    topicPaths: collected.topicPaths,
    segmentEquivalences,
  };
  const llmCollected = await runStage("M1 collectTerms (llm)", async () =>
    collectMergeTerms(llmRecords, baseOntology)
  );

  const recordsForReparent = prepareRecordsBeforeReattach(
    llmRecords,
    {
      nodes: llmCollected.nodes,
      mappings: llmCollected.mappings,
      topicPaths: llmCollected.topicPaths,
      segmentEquivalences,
    }
  );
  const reparentInput = buildTrieReparentInput(recordsForReparent, {
    segmentEquivalences,
    ontologyNodes: llmCollected.nodes,
    topicPaths: llmCollected.topicPaths,
    projectSlug: opts.projectSlug,
    mergeMode: opts.mergeMode,
    snapshotSessionId: opts.snapshotSessionId,
  });
  const allRecordsForReparent = prepareRecordsBeforeReattach(
    opts.records,
    {
      nodes: collected.nodes,
      mappings: collected.mappings,
      topicPaths: collected.topicPaths,
      segmentEquivalences,
    }
  );
  const allReparentInput = buildTrieReparentInput(allRecordsForReparent, {
    segmentEquivalences,
    ontologyNodes: collected.nodes,
    topicPaths: collected.topicPaths,
    projectSlug: opts.projectSlug,
  });

  const hasCachedReattach =
    (cached?.reattachSteps?.length ?? 0) > 0 ||
    (cached?.reattachMoves?.length ?? 0) > 0;
  const reattachVersionStale =
    cached != null &&
    cached.meta.promptVersions.reattach !== REATTACH_PROMPT_VERSION;
  const needsConceptMerge =
    reparentInput.topBranches.length >= 2 &&
    (opts.forceReattach ||
      reattachVersionStale ||
      refineMode === "batch" ||
      refineMode === "final" ||
      !hasCachedReattach);

  if (needsConceptMerge) {
    progress?.report("M-merge: LLM concept mind map merge (fold + reattach)…");
    const reparent = await runStage(
      "M-merge conceptMerge",
      () =>
        mergeTrieReparent(
          {
            records: llmRecords,
            segmentEquivalences,
            ontologyNodes: llmCollected.nodes,
            topicPaths: llmCollected.topicPaths,
            ontologyMappings: llmCollected.mappings,
            projectSlug: opts.projectSlug,
            model: opts.model,
            hostId: opts.hostId,
            promptLanguage: opts.promptLanguage,
            mergeMode: opts.mergeMode,
            snapshotSessionId: opts.snapshotSessionId,
          },
          provider,
          opts.signal,
          progress
        ),
      () => ({ kind: "llm" })
    );
    const deltaSteps = reparent.steps.length ? reparent.steps : [];
    if (opts.existingReattachSteps?.length && deltaSteps.length) {
      reattachSteps = appendReattachSteps(opts.existingReattachSteps, deltaSteps);
    } else if (opts.existingReattachSteps?.length && !deltaSteps.length) {
      reattachSteps = opts.existingReattachSteps;
    } else if (deltaSteps.length) {
      reattachSteps = deltaSteps;
    } else if (cached?.reattachSteps?.length) {
      reattachSteps = cached.reattachSteps;
    } else {
      reattachSteps = undefined;
    }
    reattachMoves =
      reattachSteps?.length && reparentInput.chains.length
        ? reattachStepsToMoves(reattachSteps)
        : reparent.moves;
  } else if (opts.existingReattachSteps?.length) {
    reattachSteps = opts.existingReattachSteps;
    reattachMoves =
      reattachSteps.length && reparentInput.chains.length
        ? reattachStepsToMoves(reattachSteps)
        : cached?.reattachMoves;
    progress?.report("M-merge: Using snapshot reattach steps (no LLM)…");
    await runStage("M-merge conceptMerge", async () => reattachMoves, () => ({
      kind: "llm",
      cacheHit: true,
      skipped: true,
    }));
  } else if (cached?.reattachMoves || cached?.reattachSteps) {
    reattachSteps = cached?.reattachSteps;
    reattachMoves = cached?.reattachMoves;
    progress?.report("M-merge: Concept merge cache hit…");
    const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
    const reattachPrompt = buildReattachPrompt(
      reparentInput,
      hostId,
      opts.promptLanguage ?? "zh",
      opts.mergeMode
    );
    void dumpLlmReplay({
      stageId: "reattach-moves",
      responseSchema: "reattach-moves",
      providerId: opts.providerId,
      model: opts.model,
      prompt: reattachPrompt,
      parsed: {
        steps: reattachSteps ?? [],
        moves: reattachMoves ?? [],
      },
      source: "ontology-cache",
      projectSlug: opts.projectSlug,
    });
    await runStage("M-merge conceptMerge", async () => reattachMoves, () => ({
      kind: "llm",
      cacheHit: true,
      skipped: true,
    }));
  }

  const prefixInferred = inferPrefixSubordinateSteps(
    allReparentInput.chains,
    reattachSteps ?? []
  );
  if (prefixInferred.length) {
    reattachSteps = appendReattachSteps(reattachSteps ?? [], prefixInferred);
    reattachMoves =
      reattachSteps.length && allReparentInput.chains.length
        ? reattachStepsToMoves(reattachSteps)
        : reattachMoves;
  }

  const ontologyPayload = {
    nodes: collected.nodes,
    mappings: collected.mappings,
    topicPaths: collected.topicPaths,
    segmentEquivalences,
    reattachMoves: reattachMoves?.length ? reattachMoves : undefined,
    reattachSteps: reattachSteps?.length ? reattachSteps : undefined,
  };

  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const ontology = await runStage(
    "M2b writeOntology",
    () =>
      writeOntologyRecord(
        opts.storeDir,
        cacheKey,
        opts.records,
        hostId,
        { model: opts.model, hostId: opts.hostId },
        provider,
        ontologyPayload
      ),
    () => ({ kind: "io" })
  );

  progress?.report("M3: Updating concept trie…");
  const merge = await runStage(
    "M3 updateTrie",
    () =>
      updateConceptTrieAsync({
        records: opts.records,
        segmentEquivalences,
        reattachMoves: ontology.reattachMoves,
        reattachSteps,
        ontology,
        projectSlug: opts.projectSlug,
      }),
    () => ({ kind: "det" })
  );

  await timing?.finish();

  return { merge, ontology, records: opts.records };
}
