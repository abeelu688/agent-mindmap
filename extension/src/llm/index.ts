import { CursorCliProvider } from "./cursorCliProvider";
import { LlmProviderError, type LlmProvider, type LlmProviderOptions } from "./types";

export function getProvider(options: LlmProviderOptions): LlmProvider {
  switch (options.provider) {
    case "cursor-cli":
      return new CursorCliProvider(options);
    default: {
      // Exhaustiveness check; future providers (openai / anthropic) land here.
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
  LlmProviderOptions,
  SummarizeInput,
  Topic,
  TopicGraph,
  TopicItem,
} from "./types";
