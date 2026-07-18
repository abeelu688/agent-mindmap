import { ClaudeCliProvider } from "./claudeCliProvider";
import { CursorCliProvider } from "./cursorCliProvider";
import { LlmProviderError, type LlmProvider, type LlmProviderOptions } from "./types";

/**
 * Create an LLM provider from the given options.
 *
 * This is the VS Code-free provider factory — both extension and CLI
 * should use this instead of a local copy.
 */
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
