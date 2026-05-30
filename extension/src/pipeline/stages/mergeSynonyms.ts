import type { AgentHostId } from "../../host/types";
import {
  buildOntologyRefinePrompt,
  buildRefineInputFromRecords,
  ONTOLOGY_REFINE_PROMPT_VERSION,
} from "../../llm/promptOntologyRefine";
import { validateOntologyRefine } from "../../llm/pipelineValidate";
import {
  buildRefineContextSamples,
  collectSessionSegmentEquivalences,
  enhanceSegmentEquivalencesForMerge,
} from "../../llm/segmentContext";
import type { LlmProvider, SegmentEquivalence } from "../../llm/types";
import type { MindMapProgress } from "../../progress";
import { createHeartbeat } from "../../progress";
import type { SessionRecord } from "../../store/storeTypes";
import type { CollectedMergeTerms } from "./collectMergeTerms";

export type MergeSynonymsOpts = {
  records: SessionRecord[];
  collected: CollectedMergeTerms;
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: "zh" | "en";
};

/**
 * M2 LLM + DET: cross-session synonym merge (ontology-refine schema).
 */
export async function mergeSynonyms(
  opts: MergeSynonymsOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SegmentEquivalence[]> {
  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const topicPaths = opts.collected.topicPaths;
  const sessionEquivalences = collectSessionSegmentEquivalences(opts.records);

  const input = buildRefineInputFromRecords(
    opts.records,
    {
      nodes: opts.collected.nodes,
      mappings: opts.collected.mappings,
      topicPaths,
    },
    topicPaths
  );
  input.contextSamples = buildRefineContextSamples(
    topicPaths,
    opts.collected.contextIndex
  );

  const prompt = buildOntologyRefinePrompt(
    input,
    hostId,
    opts.promptLanguage ?? "zh"
  );

  const heartbeat = createHeartbeat(
    progress,
    "Merging cross-session synonyms…"
  );
  try {
    const res = await provider.summarize(
      {
        events: [],
        prompt,
        model: opts.model,
        maxTopics: 8,
        maxItemsPerTopic: 8,
        responseSchema: "ontology-refine",
      },
      signal
    );
    const refined = validateOntologyRefine(res);
    return enhanceSegmentEquivalencesForMerge(
      topicPaths,
      opts.collected.nodes,
      sessionEquivalences,
      refined.segmentEquivalences
    );
  } catch {
    return enhanceSegmentEquivalencesForMerge(
      topicPaths,
      opts.collected.nodes,
      sessionEquivalences
    );
  } finally {
    heartbeat.stop();
  }
}

export { ONTOLOGY_REFINE_PROMPT_VERSION };
