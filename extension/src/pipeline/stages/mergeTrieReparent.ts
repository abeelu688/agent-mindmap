import type { AgentHostId } from "../../host/types";
import { tryParseReattachMoves } from "../../llm/ontologyValidate";
import {
  buildReattachPrompt,
  REATTACH_PROMPT_VERSION,
} from "../../llm/promptReattach";
import { buildTrieReparentInput } from "../../llm/trieReparentInput";
import type {
  ConceptOntologyNode,
  LlmProvider,
  ReattachMove,
  SegmentEquivalence,
} from "../../llm/types";
import type { MindMapProgress } from "../../progress";
import { createHeartbeat } from "../../progress";
import type { SessionRecord } from "../../store/storeTypes";

export type MergeTrieReparentOpts = {
  records: SessionRecord[];
  segmentEquivalences: SegmentEquivalence[];
  ontologyNodes?: ConceptOntologyNode[];
  projectSlug?: string;
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: "zh" | "en";
};

/** M2.5 LLM: root-branch reparent onto other chains (sole mechanism for root attach). */
export async function mergeTrieReparent(
  opts: MergeTrieReparentOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<ReattachMove[]> {
  const input = buildTrieReparentInput(opts.records, {
    segmentEquivalences: opts.segmentEquivalences,
    ontologyNodes: opts.ontologyNodes,
    projectSlug: opts.projectSlug,
  });

  if (input.topBranches.length < 2) {
    return [];
  }

  const hostId = opts.hostId ?? opts.records[0]?.meta.hostId ?? "cursor";
  const prompt = buildReattachPrompt(
    input,
    hostId,
    opts.promptLanguage ?? "zh"
  );

  const heartbeat = createHeartbeat(
    progress,
    "Reparenting top-level concept branches…"
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
    return tryParseReattachMoves(res);
  } catch {
    return [];
  } finally {
    heartbeat.stop();
  }
}

export { REATTACH_PROMPT_VERSION };
