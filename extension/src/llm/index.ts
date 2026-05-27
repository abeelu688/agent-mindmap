import { ClaudeCliProvider } from "./claudeCliProvider";
import { CursorCliProvider } from "./cursorCliProvider";
import { LlmProviderError, type LlmProvider, type LlmProviderOptions } from "./types";

export function getProvider(options: LlmProviderOptions): LlmProvider {
  switch (options.provider) {
    case "cursor-cli":
      return new CursorCliProvider(options);
    case "claude-cli":
      return new ClaudeCliProvider(options);
    default: {
      const exhaustive: never = options.provider;
      throw new LlmProviderError(
        "cli-failed",
        `Unknown LLM provider: ${String(exhaustive)}`
      );
    }
  }
}

export { LlmProviderError } from "./types";
export type {
  LlmProvider,
  LlmProviderId,
  LlmProviderOptions,
  SummarizeInput,
  Topic,
  TopicGraph,
  TopicItem,
} from "./types";
