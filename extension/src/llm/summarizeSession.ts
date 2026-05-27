import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { buildPrompt, type PromptOptions } from "./prompt";
import { validateTopicGraph } from "./cursorCliProvider";
import {
  LlmProviderError,
  type LlmProvider,
  type TopicGraph,
} from "./types";
import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";

export type SummarizeOptions = {
  prompt: PromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
};

function computeCacheKey(
  events: ChatEvent[],
  opts: SummarizeOptions,
  providerId: string,
  prompt: string
): string {
  const hash = createHash("sha256");
  hash.update(providerId);
  hash.update("\0");
  hash.update(opts.hostId ?? "cursor");
  hash.update("\0");
  hash.update(JSON.stringify(opts.prompt));
  hash.update("\0");
  hash.update(opts.modelHint ?? "");
  hash.update("\0");
  hash.update(JSON.stringify(events));
  hash.update("\0");
  hash.update(prompt);
  return hash.digest("hex");
}

async function readCache(
  cacheDir: string,
  key: string
): Promise<TopicGraph | undefined> {
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validateTopicGraph(parsed);
  } catch {
    return undefined;
  }
}

async function writeCache(
  cacheDir: string,
  key: string,
  graph: TopicGraph
): Promise<void> {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(graph, null, 2), "utf8");
  } catch {
    // cache is best-effort
  }
}

export async function summarizeSession(
  events: ChatEvent[],
  opts: SummarizeOptions,
  provider: LlmProvider,
  signal: AbortSignal
): Promise<TopicGraph> {
  if (!events.length) {
    throw new LlmProviderError("empty", "Transcript has no events to summarize");
  }

  const prompt = buildPrompt(events, opts.prompt, opts.hostId ?? "cursor");
  const cacheKey = computeCacheKey(events, opts, provider.id, prompt);
  const useCache = opts.cache && !!opts.cacheDir;

  if (useCache && opts.cacheDir) {
    const cached = await readCache(opts.cacheDir, cacheKey);
    if (cached) {
      return cached;
    }
  }

  const graph = await provider.summarize(
    {
      events,
      prompt,
      model: opts.modelHint,
      maxTopics: opts.prompt.maxTopics,
      maxItemsPerTopic: opts.prompt.maxItemsPerTopic,
    },
    signal
  );

  if (useCache && opts.cacheDir) {
    await writeCache(opts.cacheDir, cacheKey, graph);
  }

  return graph;
}

export const __testing = { computeCacheKey };
