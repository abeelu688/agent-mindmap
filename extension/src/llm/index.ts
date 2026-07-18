import { ClaudeCliProvider } from "@agent-mindmap/core";
import { CursorCliProvider } from "@agent-mindmap/core";
import { LlmProviderError, type LlmProvider, type LlmProviderOptions } from "@agent-mindmap/core";

export function getProvider(options: LlmProviderOptions): LlmProvider {
  switch (options.provider) {
    case "cursor-cli":
      return new CursorCliProvider(options);
    case "claude-cli":
      return new ClaudeCliProvider(options);
    default: {
      const exhaustive: never = options.provider;
      throw new LlmProviderError("cli-failed", `Unknown LLM provider: ${String(exhaustive)}`);
    }
  }
}

export { LlmProviderError } from "@agent-mindmap/core";
export type {
  LlmProvider,
  LlmProviderId,
  LlmProviderOptions,
  LlmSummarizeResult,
  MergedOutline,
  OutlineDetail,
  OutlineNode,
  SessionOutline,
  SummarizeInput,
  Topic,
  TopicGraph,
  TopicItem,
} from "@agent-mindmap/core";
export { PROMPT_VERSION } from "@agent-mindmap/core";
