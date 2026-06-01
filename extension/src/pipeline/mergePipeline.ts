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
import { mergeSynonyms } from "./stages/mergeSynonyms";
import { mergeTrieReparent } from "./stages/mergeTrieReparent";
import {
  prepareRecordsBeforeReattach,
  updateConceptTrieAsync,
} from "./stages/updateConceptTrie";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "../llm/promptSessionAnalysis";
import { ONTOLOGY_REFINE_PROMPT_VERSION } from "../llm/promptOntologyRefine";
import { REATTACH_PROMPT_VERSION } from "../llm/promptReattach";
import { deriveSegmentEquivalencesFromReattachStructure } from "../llm/reattachStructuralHints";
import { enhanceSegmentEquivalencesForMerge } from "../llm/synonymHintDerive";
import { buildTrieReparentInput } from "../llm/trieReparentInput";
import { createPipelineTimingCollector } from "./pipelineTiming";

export type MergeRefineMode = "batch" | "final" | "skip";

export type MergePipelineOpts = {
  storeDir: string;
  records: SessionRecord[];
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
  /** Batch milestone: always run M2.5 even when ontology cache has reattachMoves. */
  forceReattach?: boolean;
};

export type MergePipelineResult = {
  merge: MergeRecord;
  ontology: ConceptOntologyRecord;
  records: SessionRecord[];
};

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
    ONTOLOGY_REFINE_PROMPT_VERSION,
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

  let segmentEquivalences = baseOntology?.segmentEquivalences ?? [];
  const cached = await readOntologyRecord(opts.storeDir, cacheKey);

  if (refineMode !== "skip") {
    const needsRefine =
      refineMode === "batch" ||
      refineMode === "final" ||
      !cached?.segmentEquivalences;

    if (needsRefine) {
      progress?.report("M2: Merging cross-session synonyms…");
      segmentEquivalences = await runStage(
        "M2 mergeSynonyms",
        () =>
          mergeSynonyms(
            {
              records: opts.records,
              collected,
              model: opts.model,
              hostId: opts.hostId,
              promptLanguage: opts.promptLanguage,
            },
            provider,
            opts.signal,
            progress
          ),
        () => ({ kind: "llm" })
      );
    } else if (cached?.segmentEquivalences) {
      segmentEquivalences = cached.segmentEquivalences;
      progress?.report("M2: Ontology synonym cache hit…");
      await runStage("M2 mergeSynonyms", async () => segmentEquivalences, () => ({
        kind: "llm",
        cacheHit: true,
        skipped: true,
      }));
    }
  } else if (cached?.segmentEquivalences) {
    segmentEquivalences = cached.segmentEquivalences;
    await runStage("M2 mergeSynonyms", async () => segmentEquivalences, () => ({
      kind: "llm",
      cacheHit: true,
      skipped: true,
      refineMode: "skip",
    }));
  }

  let reattachMoves = cached?.reattachMoves;
  let reattachSteps: ReattachStep[] | undefined;
  const ontologyForReparent = {
    nodes: collected.nodes,
    mappings: collected.mappings,
    topicPaths: collected.topicPaths,
    segmentEquivalences,
  };
  const recordsForReparent = prepareRecordsBeforeReattach(
    opts.records,
    ontologyForReparent
  );
  const reparentInputPass = buildTrieReparentInput(recordsForReparent, {
    segmentEquivalences,
    ontologyNodes: collected.nodes,
    topicPaths: collected.topicPaths,
    projectSlug: opts.projectSlug,
  });
  segmentEquivalences = enhanceSegmentEquivalencesForMerge(
    collected.topicPaths,
    collected.nodes,
    segmentEquivalences,
    deriveSegmentEquivalencesFromReattachStructure(
      reparentInputPass.chains,
      collected.topicPaths,
      collected.nodes,
      segmentEquivalences
    )
  );
  const reparentInput = buildTrieReparentInput(recordsForReparent, {
    segmentEquivalences,
    ontologyNodes: collected.nodes,
    topicPaths: collected.topicPaths,
    projectSlug: opts.projectSlug,
  });
  // M2.5 runs on the origin trie (segment equiv applied, reattach not yet applied).
  // Decoupled from M2 refineMode so opening Concept Mind Map still reparents when cache misses.
  const hasCachedReattach =
    (cached?.reattachSteps?.length ?? 0) > 0 ||
    (cached?.reattachMoves?.length ?? 0) > 0;
  const reattachVersionStale =
    cached != null &&
    cached.meta.promptVersions.reattach !== REATTACH_PROMPT_VERSION;
  const needsTrieReparent =
    reparentInput.topBranches.length >= 2 &&
    (opts.forceReattach ||
      reattachVersionStale ||
      refineMode === "batch" ||
      refineMode === "final" ||
      !hasCachedReattach);

  if (needsTrieReparent) {
    progress?.report("M2.5: LLM root-branch reparent (origin → final)…");
    const reparent = await runStage(
      "M2.5 mergeTrieReparent",
      () =>
        mergeTrieReparent(
          {
            records: opts.records,
            segmentEquivalences,
            ontologyNodes: collected.nodes,
            topicPaths: collected.topicPaths,
            ontologyMappings: collected.mappings,
            projectSlug: opts.projectSlug,
            model: opts.model,
            hostId: opts.hostId,
            promptLanguage: opts.promptLanguage,
          },
          provider,
          opts.signal,
          progress
        ),
      () => ({ kind: "llm" })
    );
    reattachMoves = reparent.moves;
    reattachSteps = reparent.steps.length ? reparent.steps : undefined;
  } else if (cached?.reattachMoves) {
    progress?.report("M2.5: Root reparent cache hit…");
    await runStage("M2.5 mergeTrieReparent", async () => reattachMoves, () => ({
      kind: "llm",
      cacheHit: true,
      skipped: true,
    }));
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
