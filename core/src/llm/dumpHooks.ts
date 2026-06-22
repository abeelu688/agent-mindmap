/**
 * Pluggable hook for LLM IO dumping. Extension wires it up at activation;
 * CLI may register its own implementation. Default is a no-op.
 *
 * The actual payload shape mirrors what `extension/src/llm/llmIoDump.ts`
 * historically accepts so the extension's existing dump writer can be
 * registered as-is.
 */

import type { LlmDumpMeta, LlmResponseSchema } from "./types";

export type DumpLlmCallResultArgs = {
  input: {
    prompt: string;
    model?: string;
    responseSchema?: LlmResponseSchema;
    dumpMeta?: LlmDumpMeta;
  };
  providerId: string;
  stdout: string;
  stderr?: string;
  parsed?: unknown;
  error?: unknown;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  dumpRoot?: string;
};

let dumper: (args: DumpLlmCallResultArgs) => Promise<void> = () =>
  Promise.resolve();

export function setLlmIoDumper(fn: (args: DumpLlmCallResultArgs) => Promise<void>): void {
  dumper = fn;
}

export async function dumpLlmCallResult(args: DumpLlmCallResultArgs): Promise<void> {
  return dumper(args);
}
