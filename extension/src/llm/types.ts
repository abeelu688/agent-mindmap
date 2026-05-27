import type { ChatEvent } from "../transcript/types";
import type { AgentHostId } from "../host/types";

export type LlmProviderId = "cursor-cli" | "claude-cli";

export type TopicItem = {
  text: string;
  sourceTurnIndices?: number[];
};

export type Topic = {
  title: string;
  summary?: string;
  /**
   * Optional concept path from broadest to narrowest, e.g.
   * `["android", "ipc", "binder"]` for a topic titled "Binder 驱动".
   *
   * Used as cross-session merge metadata: a deterministic merge groups topics
   * by their longest common concept-path prefix into a concept trie. It is
   * NOT rendered in the single-session mind map.
   */
  conceptPath?: string[];
  items: TopicItem[];
};

export type TopicGraph = {
  /** 5-15 字整体主题，LLM 归纳；用作思维导图根节点。 */
  title?: string;
  /** 一句话（≤ 50 字）整体概述，可选。 */
  summary?: string;
  topics: Topic[];
};

export type OutlineDetail = {
  text: string;
  sourceTurnIndices?: number[];
};

export type OutlineNode = {
  title: string;
  summary?: string;
  /** Cross-session merge metadata (not shown in single-session map). */
  conceptPath?: string[];
  children?: OutlineNode[];
  details?: OutlineDetail[];
};

export type SessionOutline = {
  title?: string;
  summary?: string;
  outline: OutlineNode[];
};

export type MergedOutlineSource = {
  sessionIndex: number;
  turnIndex?: number;
};

export type MergedOutlineDetail = {
  text: string;
  sources?: MergedOutlineSource[];
};

export type MergedOutlineNode = {
  title: string;
  summary?: string;
  children?: MergedOutlineNode[];
  details?: MergedOutlineDetail[];
};

export type MergedOutline = {
  title?: string;
  summary?: string;
  outline: MergedOutlineNode[];
};

export type LlmResponseSchema =
  | "session-outline"
  | "topic-graph"
  | "merged-outline";

export type SummarizeInput = {
  events: ChatEvent[];
  prompt: string;
  model?: string;
  maxTopics: number;
  maxItemsPerTopic: number;
  /** Which JSON schema to validate CLI output against. */
  responseSchema?: LlmResponseSchema;
};

export type LlmProviderOptions = {
  provider: LlmProviderId;
  cliPath: string;
  model: string;
  timeoutMs: number;
  /** Maximum number of attempts (≥ 1). Retries skip non-retryable errors. */
  maxAttempts: number;
  /**
   * Base backoff in ms between retries. Effective wait is
   * `base * 2^(attempt-1) + jitter` capped at 10s.
   */
  retryBackoffMs: number;
  maxTopics: number;
  maxItemsPerTopic: number;
  hostId?: AgentHostId;
};

export type LlmSummarizeResult = TopicGraph | SessionOutline | MergedOutline;

export type LlmProvider = {
  readonly id: string;
  summarize(
    input: SummarizeInput,
    signal: AbortSignal
  ): Promise<LlmSummarizeResult>;
};

export type LlmErrorCode =
  | "cli-missing"
  | "cli-failed"
  | "timeout"
  | "cancelled"
  | "bad-json"
  | "bad-shape"
  | "empty";

export class LlmProviderError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
