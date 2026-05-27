import { HeadlessCliProvider } from "./headlessCli";
import type {
  LlmProvider,
  LlmProviderOptions,
  LlmSummarizeResult,
} from "./types";
import type { SummarizeInput } from "./types";

export {
  canonicalizeConceptSegment,
  validateTopicGraph,
} from "./topicGraphValidate";
export { validateSessionOutline, validateMergedOutline } from "./outlineValidate";

const DEFAULT_BINARIES = ["agent", "cursor-agent"];

function buildArgs(opts: LlmProviderOptions, prompt: string): string[] {
  const args = ["-p", "--force", "--trust", "--output-format", "json"];
  if (opts.model && opts.model.trim()) {
    args.push("--model", opts.model.trim());
  }
  args.push(prompt);
  return args;
}

export { __testing } from "./headlessCli";

export class CursorCliProvider implements LlmProvider {
  public readonly id = "cursor-cli";
  private readonly inner: HeadlessCliProvider;

  constructor(options: LlmProviderOptions) {
    this.inner = new HeadlessCliProvider("cursor-cli", {
      providerLabel: "cursor-agent",
      defaultBinaries: DEFAULT_BINARIES,
      missingInstallHint:
        "cursor-agent CLI not found. Install via: curl https://cursor.com/install -fsS | bash",
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
