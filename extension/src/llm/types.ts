import type { ChatEvent } from "../transcript/types";

export type TopicItem = {
  text: string;
  sourceTurnIndices?: number[];
};

export type Topic = {
  title: string;
  summary?: string;
  items: TopicItem[];
};

export type TopicGraph = {
  topics: Topic[];
};

export type SummarizeInput = {
  events: ChatEvent[];
  prompt: string;
  model?: string;
  maxTopics: number;
  maxItemsPerTopic: number;
};

export type LlmProviderOptions = {
  provider: "cursor-cli";
  cliPath: string;
  model: string;
  timeoutMs: number;
  maxTopics: number;
  maxItemsPerTopic: number;
};

export type LlmProvider = {
  readonly id: string;
  summarize(input: SummarizeInput, signal: AbortSignal): Promise<TopicGraph>;
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
