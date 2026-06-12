import { HeadlessCliProvider } from "./headlessCli";
import type {
  LlmProvider,
  LlmProviderOptions,
  LlmSummarizeResult,
} from "./types";
import type { SummarizeInput } from "./types";

const DEFAULT_BINARIES = ["claude"];

function buildArgs(opts: LlmProviderOptions, prompt: string): string[] {
  const args = [
    "-p",
    "--bare",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--tools",
    "",
  ];
  if (opts.model && opts.model.trim()) {
    args.push("--model", opts.model.trim());
  }
  args.push(prompt);
  return args;
}

export class ClaudeCliProvider implements LlmProvider {
  public readonly id = "claude-cli";
  private readonly inner: HeadlessCliProvider;

  constructor(options: LlmProviderOptions) {
    this.inner = new HeadlessCliProvider("claude-cli", {
      providerLabel: "claude",
      defaultBinaries: DEFAULT_BINARIES,
      missingInstallHint:
        "Claude Code CLI not found. Install from https://code.claude.com/docs/en/headless",
      buildArgs,
    }, options);
  }

  summarize(
    input: SummarizeInput,
    signal: AbortSignal
  ): Promise<LlmSummarizeResult> {
    return this.inner.summarize(input, signal);
  }
}
