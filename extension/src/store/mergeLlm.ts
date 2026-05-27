import type { AgentHostId } from "../host/types";
import { buildMergePrompt } from "../llm/promptMerge";
import {
  LlmProviderError,
  type LlmProvider,
  type TopicGraph,
} from "../llm/types";
import { buildTopicMindMap } from "../mindmap/buildTopicMindMap";
import type { MindMapRoot } from "../transcript/types";
import {
  llmMergeCachePath,
  llmRefinedMergePath,
  readMergeRecord,
  sha256Hex,
  writeMergeRecord,
} from "./sessionStore";
import type { MergeRecord, SessionRecord } from "./storeTypes";

export type MergeLlmOptions = {
  maxTopics: number;
  maxItemsPerTopic: number;
  /** Override the merged mind-map root label. */
  title?: string;
  /** Model hint, propagated to provider and folded into the cache key. */
  model?: string;
  hostId?: AgentHostId;
};

/**
 * Cache key = sha256 of:
 *   - sorted session ids
 *   - prompt parameters
 *   - provider id + model
 *
 * The selection set + LLM config fully determines the merge output, so the
 * same selection can be reopened later without spending tokens.
 */
export function computeMergeCacheKey(
  records: SessionRecord[],
  opts: MergeLlmOptions,
  providerId: string
): string {
  const sortedIds = records.map((r) => r.meta.sessionId).sort();
  const payload = JSON.stringify({
    sessionIds: sortedIds,
    promptParams: {
      maxTopics: opts.maxTopics,
      maxItemsPerTopic: opts.maxItemsPerTopic,
    },
    provider: providerId,
    model: opts.model?.trim() || "",
  });
  return sha256Hex(payload);
}

function projectSlugsFor(records: SessionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.meta.projectSlug))).sort();
}

function buildRefinedMindMap(
  graph: TopicGraph,
  rootTitleOverride?: string
): MindMapRoot {
  // Reuse buildTopicMindMap so the rendered tree looks consistent with
  // single-session views; allow caller to override the root label.
  const root = buildTopicMindMap(graph, rootTitleOverride);
  return root;
}

/**
 * Run an LLM merge across the given session records.
 *
 * On success:
 *   - writes the result to `<storeDir>/merges/cache/<key>.json`
 *   - mirrors it to `<storeDir>/merges/llm-refined.json`
 *
 * If the same selection set + config has been merged before, returns the
 * cached MergeRecord without contacting the LLM.
 */
export async function mergeWithLlm(
  records: SessionRecord[],
  opts: MergeLlmOptions,
  provider: LlmProvider,
  storeDir: string,
  signal: AbortSignal
): Promise<MergeRecord> {
  if (!records.length) {
    throw new LlmProviderError("empty", "No sessions selected to merge");
  }

  const cacheKey = computeMergeCacheKey(records, opts, provider.id);
  const cacheFile = llmMergeCachePath(storeDir, cacheKey);
  const cached = await readMergeRecord(cacheFile);
  if (cached) {
    // Refresh the llm-refined.json pointer to whatever was loaded.
    await writeMergeRecord(llmRefinedMergePath(storeDir), cached);
    return cached;
  }

  const hostId =
    opts.hostId ??
    records[0]?.meta.hostId ??
    "cursor";
  const prompt = buildMergePrompt(
    records,
    {
      maxTopics: opts.maxTopics,
      maxItemsPerTopic: opts.maxItemsPerTopic,
    },
    hostId
  );

  const graph = await provider.summarize(
    {
      events: [],
      prompt,
      model: opts.model,
      maxTopics: opts.maxTopics,
      maxItemsPerTopic: opts.maxItemsPerTopic,
    },
    signal
  );

  const mindMap = buildRefinedMindMap(graph, opts.title ?? graph.title);
  const record: MergeRecord = {
    schemaVersion: 1,
    meta: {
      kind: "llm-refined",
      builtAt: Date.now(),
      sessionIds: records.map((r) => r.meta.sessionId),
      projectSlugs: projectSlugsFor(records),
      llm: {
        provider: provider.id,
        model: opts.model?.trim() || undefined,
      },
      title:
        typeof mindMap.data.text === "string" ? mindMap.data.text : undefined,
    },
    mindMap,
  };

  await writeMergeRecord(cacheFile, record);
  await writeMergeRecord(llmRefinedMergePath(storeDir), record);
  return record;
}
