import { spawn } from "child_process";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmProviderOptions,
  type SummarizeInput,
  type TopicGraph,
} from "./types";

const DEFAULT_BINARIES = ["agent", "cursor-agent"];

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

function buildArgs(opts: LlmProviderOptions, prompt: string): string[] {
  const args = [
    "-p",
    "--force",
    "--trust",
    "--output-format",
    "json",
  ];
  if (opts.model && opts.model.trim()) {
    args.push("--model", opts.model.trim());
  }
  // cursor-agent `-p` mode reads the prompt from argv, NOT from stdin.
  // Piping to stdin causes it to hang waiting for input.
  args.push(prompt);
  return args;
}

// Linux ARG_MAX is typically 128KB+. macOS is 256KB. We cap conservatively
// to leave headroom for env vars and the rest of the argv slot.
const MAX_PROMPT_BYTES = 96 * 1024;

type RunResult = { stdout: string; stderr: string };

function runCli(
  bin: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs: number
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    let proc;
    try {
      proc = spawn(bin, args, {
        // stdin is intentionally ignored; cursor-agent -p reads prompt from argv.
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
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
            `cursor-agent timed out after ${timeoutMs}ms`
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

/**
 * cursor-agent --output-format json wraps the assistant reply in something like
 * `{ "type": "result", "result": "..." }` (subject to change). We try to
 * extract a textual payload from common shapes, then look for the embedded
 * mind-map JSON inside it.
 */
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

  const pickString = (obj: unknown): string | undefined => {
    if (typeof obj !== "object" || obj === null) {
      return undefined;
    }
    const o = obj as Record<string, unknown>;
    for (const key of ["result", "response", "content", "text", "message", "output"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) {
        return v;
      }
    }
    return undefined;
  };

  // Whole stdout is JSON
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) {
    if (Array.isArray(direct)) {
      for (const item of direct) {
        const s = pickString(item);
        if (s) {
          return s;
        }
      }
    } else {
      const s = pickString(direct);
      if (s) {
        return s;
      }
    }
  }

  // NDJSON: take last well-formed line that yields a string payload
  let fallback = "";
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      continue;
    }
    const obj = tryParseJson(t);
    const s = pickString(obj);
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
  // Try direct parse first
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // fall through
  }
  // Find first balanced {...} that contains "topics"
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

function parseTopicGraph(stdout: string): TopicGraph {
  const payload = extractPayload(stdout);
  if (!payload.trim()) {
    throw new LlmProviderError("empty", "cursor-agent returned empty output");
  }
  const jsonText = extractTopicsJson(payload);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new LlmProviderError(
      "bad-json",
      `Failed to parse JSON from cursor-agent: ${(err as Error).message}`,
      err
    );
  }

  return validateTopicGraph(parsed);
}

const MAX_ROOT_TITLE = 80;
const MAX_ROOT_SUMMARY = 120;
const MAX_CONCEPT_PATH_SEGMENTS = 6;
const MAX_CONCEPT_SEGMENT_LEN = 24;

/**
 * Normalise a concept path returned by the LLM.
 *
 * Accepts an array of strings; returns up to {@link MAX_CONCEPT_PATH_SEGMENTS}
 * trimmed, deduplicated segments (case-preserving but case-insensitive dedup
 * to fold "android" / "Android"). Returns `undefined` when no usable segments
 * remain, so consumers can `if (path)` to gate on its presence.
 */
function parseConceptPath(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }
    const truncated =
      trimmed.length > MAX_CONCEPT_SEGMENT_LEN
        ? trimmed.slice(0, MAX_CONCEPT_SEGMENT_LEN - 3) + "..."
        : trimmed;
    const key = truncated.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(truncated);
    if (out.length >= MAX_CONCEPT_PATH_SEGMENTS) {
      break;
    }
  }
  return out.length ? out : undefined;
}

/**
 * Canonical key used to compare concept-path segments across sessions:
 * lowercased + whitespace-collapsed + trimmed. Exposed so the merge layer
 * can rebuild the same canonical mapping without re-implementing it.
 */
export function canonicalizeConceptSegment(segment: string): string {
  return segment.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
  maxLen: number
): string | undefined {
  const v = obj[key];
  if (typeof v !== "string") {
    return undefined;
  }
  const trimmed = v.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 3) + "..." : trimmed;
}

export function validateTopicGraph(value: unknown): TopicGraph {
  if (!value || typeof value !== "object") {
    throw new LlmProviderError("bad-shape", "Expected object with topics[]");
  }
  const root = value as Record<string, unknown>;
  const topics = root.topics;
  if (!Array.isArray(topics)) {
    throw new LlmProviderError("bad-shape", "Missing or non-array `topics`");
  }
  const result: TopicGraph = {
    title: pickString(root, "title", MAX_ROOT_TITLE),
    summary: pickString(root, "summary", MAX_ROOT_SUMMARY),
    topics: [],
  };
  for (const t of topics) {
    if (!t || typeof t !== "object") {
      continue;
    }
    const obj = t as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) {
      continue;
    }
    const summary =
      typeof obj.summary === "string" ? obj.summary.trim() || undefined : undefined;
    const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
    const items = [] as TopicGraph["topics"][number]["items"];
    for (const it of itemsRaw) {
      if (!it || typeof it !== "object") {
        continue;
      }
      const text =
        typeof (it as Record<string, unknown>).text === "string"
          ? ((it as Record<string, unknown>).text as string).trim()
          : "";
      if (!text) {
        continue;
      }
      const sourceTurnIndicesRaw = (it as Record<string, unknown>)
        .sourceTurnIndices;
      let sourceTurnIndices: number[] | undefined;
      if (Array.isArray(sourceTurnIndicesRaw)) {
        sourceTurnIndices = sourceTurnIndicesRaw
          .filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0)
          .slice(0, 16);
        if (!sourceTurnIndices.length) {
          sourceTurnIndices = undefined;
        }
      }
      items.push({ text, sourceTurnIndices });
    }
    if (!items.length) {
      continue;
    }
    const conceptPath = parseConceptPath(obj.conceptPath);
    result.topics.push({ title, summary, conceptPath, items });
  }
  if (!result.topics.length) {
    throw new LlmProviderError("bad-shape", "No usable topics returned");
  }
  return result;
}

/** Errors that don't benefit from retrying — bail out immediately. */
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

/**
 * Sleep that bails out promptly when the abort signal fires.
 *
 * Resolves on either (a) the timer firing or (b) the signal aborting; in the
 * aborted case it throws a `cancelled` LlmProviderError so the caller can
 * propagate the cancellation through the same channel as the actual run.
 */
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

const MAX_BACKOFF_MS = 10_000;

function computeBackoff(base: number, attempt: number): number {
  // attempt is 1-based: first retry waits `base`, second `2*base`, third `4*base`, ...
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));
  // Up to ±25% jitter to avoid synchronised retries on shared backends.
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  return Math.min(MAX_BACKOFF_MS, Math.max(0, Math.round(exp + jitter)));
}

export class CursorCliProvider implements LlmProvider {
  public readonly id = "cursor-cli";

  constructor(private readonly options: LlmProviderOptions) {}

  async summarize(
    input: SummarizeInput,
    signal: AbortSignal
  ): Promise<TopicGraph> {
    const promptBytes = Buffer.byteLength(input.prompt, "utf8");
    if (promptBytes > MAX_PROMPT_BYTES) {
      throw new LlmProviderError(
        "cli-failed",
        `Prompt too large for argv (${promptBytes}B > ${MAX_PROMPT_BYTES}B). ` +
          "Reduce agentMindmap.maxTopics/maxItemsPerTopic or trim transcript."
      );
    }

    const candidates = uniq([this.options.cliPath, ...DEFAULT_BINARIES]);
    const args = buildArgs(this.options, input.prompt);
    const maxAttempts = Math.max(1, this.options.maxAttempts || 1);
    const backoffBase = Math.max(0, this.options.retryBackoffMs || 0);

    let lastErr: LlmProviderError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let allMissing: LlmProviderError | undefined;
      let runErr: LlmProviderError | undefined;

      for (const bin of candidates) {
        try {
          const { stdout } = await runCli(
            bin,
            args,
            signal,
            this.options.timeoutMs
          );
          if (attempt > 1) {
            console.info(
              `[agent-mindmap] LLM succeeded on attempt ${attempt}/${maxAttempts}`
            );
          }
          return parseTopicGraph(stdout);
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
        new LlmProviderError(
          "cli-missing",
          "cursor-agent CLI not found. Install via: curl https://cursor.com/install -fsS | bash"
        );

      const isLastAttempt = attempt >= maxAttempts;
      if (!isRetryableError(attemptErr) || isLastAttempt) {
        throw attemptErr;
      }

      lastErr = attemptErr;
      const delay = computeBackoff(backoffBase, attempt);
      console.warn(
        `[agent-mindmap] LLM attempt ${attempt}/${maxAttempts} failed (${attemptErr.code}); retrying in ${delay}ms…`
      );
      await sleepWithCancel(delay, signal);
    }
    throw (
      lastErr ?? new LlmProviderError("cli-failed", "All attempts failed")
    );
  }
}

export const __testing = {
  extractPayload,
  extractTopicsJson,
  parseTopicGraph,
  parseConceptPath,
  isRetryableError,
  computeBackoff,
  sleepWithCancel,
};
