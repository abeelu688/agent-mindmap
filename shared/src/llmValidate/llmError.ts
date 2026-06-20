/**
 * LLM provider error class. Lives in `shared/` because the validators
 * (`outlineValidate`, `topicGraphValidate`) throw `LlmProviderError` on
 * bad shape, and those validators are shared between the extension and the
 * MCP server.
 *
 * The error code enum matches the extension's pre-existing codes. New codes
 * should be added here, not in the extension.
 */
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
    public readonly cause?: unknown,
    /** Partial CLI stdout/stderr when the subprocess ran but failed. */
    public readonly cliCapture?: { stdout: string; stderr: string }
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
