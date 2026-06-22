import { HeadlessCliProvider } from "@agent-mindmap/core";
import type {
  LlmProvider,
  LlmProviderOptions,
  LlmSummarizeResult,
} from "@agent-mindmap/core";
import type { SummarizeInput } from "@agent-mindmap/core";

export {
  canonicalizeConceptSegment,
  segmentKeyForMerge,
  validateTopicGraph,
} from "@agent-mindmap/core";
export { validateSessionOutline, validateMergedOutline } from "@agent-mindmap/core";

const DEFAULT_BINARIES = ["agent", "cursor-agent"];

function buildArgs(opts: LlmProviderOptions, prompt: string): string[] {
  const args = ["-p", "--force", "--trust", "--output-format", "json"];
  if (opts.model && opts.model.trim()) {
    args.push("--model", opts.model.trim());
  }
  args.push(prompt);
  return args;
}

export { __testing } from "@agent-mindmap/core";

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
