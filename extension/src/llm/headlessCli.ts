import { spawn } from "child_process";
import { resolveCliSpawnTarget } from "./resolveWindowsCliSpawn";
import {
  validateMergedOutline,
  validateSessionOutline,
} from "./outlineValidate";
import {
  validateConceptOntology,
  validateOntologyRefine,
  validateReattachMoves,
  validateTopicPaths,
} from "./ontologyValidate";
import {
  LlmProviderError,
  type LlmProviderOptions,
  type LlmResponseSchema,
  type MergedOutline,
  type SessionOutline,
  type SummarizeInput,
  type TopicGraph,
} from "./types";
import { validateTopicGraph } from "./topicGraphValidate";

export type HeadlessCliConfig = {
  readonly providerLabel: string;
  readonly defaultBinaries: string[];
  readonly missingInstallHint: string;
  buildArgs(opts: LlmProviderOptions, prompt: string): string[];
};

const MAX_PROMPT_BYTES = 96 * 1024;
const MAX_BACKOFF_MS = 10_000;

type RunResult = { stdout: string; stderr: string };

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of arr) {
    if (a && !seen.has(a)) {
      seen.add(a);
      out.push(a);
    }
  }
  return out;
}

function spawnCliProcess(target: ReturnType<typeof resolveCliSpawnTarget>) {
  const options = {
    stdio: ["ignore", "pipe", "pipe"] as const,
    env: process.env,
    ...(target.shell ? { shell: true as const } : {}),
  };
  return spawn(target.command, target.args, options);
}

export function runCli(
  bin: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
  providerLabel: string
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const spawnTarget = resolveCliSpawnTarget(bin, args);
    let proc;
    try {
      proc = spawnCliProcess(spawnTarget);
    } catch (err) {
      reject(
        new LlmProviderError(
          "cli-missing",
          `Failed to launch ${bin}: ${(err as Error).message}`,
          err
        )
      );
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      reject(new LlmProviderError("cancelled", "LLM call was cancelled"));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        reject(
          new LlmProviderError(
            "timeout",
            `${providerLabel} timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);
    }

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (timer) {
        clearTimeout(timer);
      }
      if (err.code === "ENOENT") {
        reject(
          new LlmProviderError(
            "cli-missing",
            `Binary not found: ${bin}`,
            err
          )
        );
      } else {
        reject(
          new LlmProviderError(
            "cli-failed",
            `Failed to spawn ${bin}: ${err.message}`,
            err
          )
        );
      }
    });

    proc.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (timer) {
        clearTimeout(timer);
      }
      if (code !== 0) {
        reject(
          new LlmProviderError(
            "cli-failed",
            `${bin} exited with code ${code}: ${stderr.trim().slice(0, 500)}`
          )
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function extractPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return "";
  }

  const tryParseJson = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const pickPayload = (obj: unknown): string | undefined => {
    if (typeof obj !== "object" || obj === null) {
      return undefined;
    }
    const o = obj as Record<string, unknown>;
    for (const key of [
      "result",
      "structured_output",
      "response",
      "content",
      "text",
      "message",
      "output",
    ]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) {
        return v;
      }
      if (v && typeof v === "object") {
        return JSON.stringify(v);
      }
    }
    return undefined;
  };

  const direct = tryParseJson(trimmed);
  if (direct !== undefined) {
    if (Array.isArray(direct)) {
      for (const item of direct) {
        const s = pickPayload(item);
        if (s) {
          return s;
        }
      }
    } else {
      const s = pickPayload(direct);
      if (s) {
        return s;
      }
    }
  }

  let fallback = "";
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    const obj = tryParseJson(t);
    const s = pickPayload(obj);
    if (s) {
      fallback = s;
    }
  }
  if (fallback) {
    return fallback;
  }

  return trimmed;
}

function stripFences(s: string): string {
  return s
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function extractTopicsJson(payload: string): string {
  const cleaned = stripFences(payload.trim());
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // fall through
  }
  const start = cleaned.indexOf("{");
  if (start < 0) {
    return cleaned;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }
  return cleaned;
}

/** Best-effort fixes for common LLM JSON mistakes (trailing commas, smart quotes). */
export function repairJsonText(s: string): string {
  return s
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");
}

function tryParseJsonLoose(text: string): unknown | undefined {
  const variants = [text, repairJsonText(text)];
  for (const candidate of variants) {
    try {
      return JSON.parse(candidate);
    } catch {
      // continue
    }
    const extracted = extractTopicsJson(candidate);
    for (const slice of [extracted, repairJsonText(extracted)]) {
      try {
        return JSON.parse(slice);
      } catch {
        // continue
      }
    }
  }
  return undefined;
}

function parseJsonFromStdout(stdout: string, providerLabel: string): unknown {
  const payload = extractPayload(stdout);
  if (!payload.trim()) {
    throw new LlmProviderError("empty", `${providerLabel} returned empty output`);
  }
  const jsonText = extractTopicsJson(payload);
  const parsed = tryParseJsonLoose(jsonText);
  if (parsed !== undefined) {
    return parsed;
  }

  throw new LlmProviderError(
    "bad-json",
    `Failed to parse JSON from ${providerLabel} (output may include prose or truncated JSON)`
  );
}

export function parseTopicGraphFromStdout(
  stdout: string,
  providerLabel: string
): TopicGraph {
  return validateTopicGraph(parseJsonFromStdout(stdout, providerLabel));
}

export function parseSessionOutlineFromStdout(
  stdout: string,
  providerLabel: string
): SessionOutline {
  return validateSessionOutline(parseJsonFromStdout(stdout, providerLabel));
}

export function parseMergedOutlineFromStdout(
  stdout: string,
  providerLabel: string
): MergedOutline {
  return validateMergedOutline(parseJsonFromStdout(stdout, providerLabel));
}

export function parseConceptOntologyFromStdout(
  stdout: string,
  providerLabel: string
) {
  return validateConceptOntology(parseJsonFromStdout(stdout, providerLabel));
}

export function parseTopicPathsFromStdout(stdout: string, providerLabel: string) {
  return validateTopicPaths(parseJsonFromStdout(stdout, providerLabel));
}

export function parseReattachMovesFromStdout(
  stdout: string,
  providerLabel: string
) {
  return validateReattachMoves(parseJsonFromStdout(stdout, providerLabel));
}

export function parseOntologyRefineFromStdout(
  stdout: string,
  providerLabel: string
) {
  return validateOntologyRefine(parseJsonFromStdout(stdout, providerLabel));
}

function parseBySchema(
  stdout: string,
  providerLabel: string,
  schema: LlmResponseSchema
): TopicGraph | SessionOutline | MergedOutline | unknown {
  switch (schema) {
    case "topic-graph":
      return parseTopicGraphFromStdout(stdout, providerLabel);
    case "merged-outline":
      return parseMergedOutlineFromStdout(stdout, providerLabel);
    case "concept-ontology":
      return parseConceptOntologyFromStdout(stdout, providerLabel);
    case "topic-paths":
      return parseTopicPathsFromStdout(stdout, providerLabel);
    case "reattach-moves":
      return parseReattachMovesFromStdout(stdout, providerLabel);
    case "ontology-refine":
      return parseOntologyRefineFromStdout(stdout, providerLabel);
    case "session-outline":
    default:
      return parseSessionOutlineFromStdout(stdout, providerLabel);
  }
}

function isRetryableError(err: LlmProviderError): boolean {
  switch (err.code) {
    case "timeout":
    case "cli-failed":
    case "bad-json":
    case "bad-shape":
      return true;
    case "cli-missing":
    case "cancelled":
    case "empty":
      return false;
    default:
      return false;
  }
}

function sleepWithCancel(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new LlmProviderError("cancelled", "LLM call was cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LlmProviderError("cancelled", "LLM call was cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function computeBackoff(base: number, attempt: number): number {
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(0, Math.round(exp + jitter)));
}

export class HeadlessCliProvider {
  constructor(
    public readonly id: string,
    private readonly config: HeadlessCliConfig,
    private readonly options: LlmProviderOptions
  ) {}

  async summarize(
    input: SummarizeInput,
    signal: AbortSignal
  ): Promise<import("./types").LlmSummarizeResult> {
    const responseSchema = input.responseSchema ?? "session-outline";
    const promptBytes = Buffer.byteLength(input.prompt, "utf8");
    if (promptBytes > MAX_PROMPT_BYTES) {
      throw new LlmProviderError(
        "cli-failed",
        `Prompt too large for argv (${promptBytes}B > ${MAX_PROMPT_BYTES}B). ` +
          "Reduce agentMindmap.maxTopics/maxItemsPerTopic or trim transcript."
      );
    }

    const candidates = uniq([
      this.options.cliPath,
      ...this.config.defaultBinaries,
    ]);
    const args = this.config.buildArgs(this.options, input.prompt);
    const maxAttempts = Math.max(1, this.options.maxAttempts || 1);
    const backoffBase = Math.max(0, this.options.retryBackoffMs || 0);

    let lastErr: LlmProviderError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      input.onAttempt?.(attempt, maxAttempts);
      let allMissing: LlmProviderError | undefined;
      let runErr: LlmProviderError | undefined;

      for (const bin of candidates) {
        try {
          const { stdout } = await runCli(
            bin,
            args,
            signal,
            this.options.timeoutMs,
            this.config.providerLabel
          );
          if (attempt > 1) {
            console.info(
              `[agent-mindmap] LLM (${this.id}) succeeded on attempt ${attempt}/${maxAttempts}`
            );
          }
          return parseBySchema(
            stdout,
            this.config.providerLabel,
            responseSchema
          );
        } catch (err) {
          const lpe =
            err instanceof LlmProviderError
              ? err
              : new LlmProviderError("cli-failed", String(err), err);
          if (lpe.code === "cli-missing") {
            allMissing = lpe;
            continue;
          }
          runErr = lpe;
          break;
        }
      }

      const attemptErr =
        runErr ??
        allMissing ??
        new LlmProviderError("cli-missing", this.config.missingInstallHint);

      const isLastAttempt = attempt >= maxAttempts;
      if (!isRetryableError(attemptErr) || isLastAttempt) {
        throw attemptErr;
      }

      lastErr = attemptErr;
      const delay = computeBackoff(backoffBase, attempt);
      console.warn(
        `[agent-mindmap] LLM (${this.id}) attempt ${attempt}/${maxAttempts} failed (${attemptErr.code}); retrying in ${delay}ms…`
      );
      await sleepWithCancel(delay, signal);
    }
    throw (
      lastErr ?? new LlmProviderError("cli-failed", "All attempts failed")
    );
  }
}

export const __testing = {
  resolveCliSpawnTarget,
  extractPayload,
  extractTopicsJson,
  repairJsonText,
  parseJsonFromStdout,
  parseTopicGraphFromStdout,
  parseSessionOutlineFromStdout,
  parseMergedOutlineFromStdout,
  isRetryableError,
  computeBackoff,
  sleepWithCancel,
};
