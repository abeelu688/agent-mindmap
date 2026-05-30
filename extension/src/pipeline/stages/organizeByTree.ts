import { runLlmStage } from "../llmStage";
import {
  buildOrganizeByTreePrompt,
  ORGANIZE_PROMPT_VERSION,
  type OrganizeByTreePromptOptions,
} from "../../llm/promptOrganizeByTree";
import { validateSessionOutline } from "../../llm/outlineValidate";
import type { LlmProvider, SessionOutline, SessionTreeSnapshot } from "../../llm/types";
import type { AgentHostId } from "../../host/types";
import type { ChatEvent } from "../../transcript/types";
import type { MindMapProgress } from "../../progress";
import type { StageTimingOpts } from "../stageTimingOpts";

export type OrganizeByTreeOpts = StageTimingOpts & {
  events: ChatEvent[];
  tree: SessionTreeSnapshot;
  prompt: OrganizeByTreePromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
};

export async function organizeByTree(
  opts: OrganizeByTreeOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionOutline> {
  const prompt = buildOrganizeByTreePrompt(
    opts.events,
    opts.tree,
    opts.prompt,
    opts.hostId ?? "cursor"
  );
  return runLlmStage(
    {
      stageId: "session-outline-by-tree",
      promptVersion: ORGANIZE_PROMPT_VERSION,
      events: opts.events,
      prompt,
      modelHint: opts.modelHint,
      cacheDir: opts.cacheDir,
      cache: opts.cache,
      hostId: opts.hostId,
      responseSchema: "session-outline-by-tree",
      maxTopics: opts.prompt.maxBranches,
      maxItemsPerTopic: opts.prompt.maxDetailsPerNode,
      heartbeatMessage: "Organizing outline by concept tree…",
      validate: validateSessionOutline,
      timingRunId: opts.timingRunId,
      timingOut: opts.timingOut,
    },
    provider,
    signal,
    progress
  );
}
