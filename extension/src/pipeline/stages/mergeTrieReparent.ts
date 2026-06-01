import type { AgentHostId } from "../../host/types";
import { resolveReattachStepsWithCatalog } from "../../llm/reattachNodeCatalog";
import { tryParseReattachResponse } from "../../llm/ontologyValidate";
import {
  normalizeSynonymAttachSteps,
  reattachStepsToMoves,
} from "../../llm/reattachSteps";
import {
  buildReattachPrompt,
  REATTACH_PROMPT_VERSION,
} from "../../llm/promptReattach";
import { buildTrieReparentInput } from "../../llm/trieReparentInput";
import type {
  ConceptOntologyMapping,
  ConceptOntologyNode,
  LlmProvider,
  ReattachMove,
  ReattachParseResult,
  ReattachStep,
  SegmentEquivalence,
  TopicPathDecision,
} from "../../llm/types";
import { prepareRecordsBeforeReattach } from "./updateConceptTrie";
import type { MindMapProgress } from "../../progress";
import { createHeartbeat } from "../../progress";
import type { SessionRecord } from "../../store/storeTypes";

export type MergeTrieReparentOpts = {
  records: SessionRecord[];
  segmentEquivalences: SegmentEquivalence[];
  ontologyNodes?: ConceptOntologyNode[];
  topicPaths?: TopicPathDecision[];
  ontologyMappings?: ConceptOntologyMapping[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: "zh" | "en";
};

export type MergeTrieReparentResult = {
  moves: ReattachMove[];
  steps: ReattachStep[];
};

/**
 * M2.5 LLM: one call with all chains; returns ordered steps + derived moves.
 */
export async function mergeTrieReparent(
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<MergeTrieReparentResult> {
  const recordsForInput = prepareRecordsBeforeReattach(opts.records, {
    nodes: opts.ontologyNodes ?? [],
    mappings: opts.ontologyMappings ?? [],
    topicPaths: opts.topicPaths ?? [],
    segmentEquivalences: opts.segmentEquivalences,
  });

  const input = buildTrieReparentInput(recordsForInput, {
    segmentEquivalences: opts.segmentEquivalences,
    ontologyNodes: opts.ontologyNodes,
    topicPaths: opts.topicPaths,
    projectSlug: opts.projectSlug,
  });

  if (input.chains.length < 2) {
    return { moves: [], steps: [] };
  }

  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const prompt = buildReattachPrompt(
    input,
    hostId,
    opts.promptLanguage ?? "zh"
  );

  const heartbeat = createHeartbeat(
    progress,
    "Reparenting top-level chains (whole mind map)…"
  );
  try {
    const res = await provider.summarize(
      {
        events: [],
        prompt,
        model: opts.model,
        maxTopics: 8,
        maxItemsPerTopic: 8,
        responseSchema: "reattach-moves",
      },
      signal
    );
    const parsed: ReattachParseResult =
      res &&
      typeof res === "object" &&
      ("steps" in res || "moves" in res)
        ? (res as ReattachParseResult)
        : tryParseReattachResponse(res);
    const resolved = resolveReattachStepsWithCatalog(
      parsed.steps,
      input.nodeCatalog
    );
    const steps = normalizeSynonymAttachSteps(
      resolved,
      input.topBranchSynonymHints,
      input.segmentEquivalences,
      input.chains.map((c) => c.from)
    );
    const moves = steps.length > 0 ? reattachStepsToMoves(steps) : parsed.moves;

    return { steps, moves };
  } catch {
    return { moves: [], steps: [] };
  } finally {
    heartbeat.stop();
  }
}

/** @deprecated Use MergeTrieReparentResult */
export async function mergeTrieReparentMovesOnly(
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<ReattachMove[]> {
  const result = await mergeTrieReparent(opts, provider, signal, progress);
  return result.moves;
}

export { REATTACH_PROMPT_VERSION };
