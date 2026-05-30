import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import type { MindMapProgress } from "../progress";
import { createHeartbeat } from "../progress";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmResponseSchema,
  type LlmSummarizeResult,
} from "../llm/types";
import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import type { PipelineKind } from "./pipelineTiming";

export type LlmStageTimingOut = {
  cacheHit?: boolean;
};

function format(message: string, args: Array<string | number | boolean>): string {
  return message.replace(/\{(\d+)\}/g, (_m, rawIdx) => {
    const idx = Number(rawIdx);
    const v = args[idx];
    return v === undefined ? "" : String(v);
  });
}

function safeT(
  key: string,
  message: string,
  ...args: Array<string | number | boolean>
): string {
  const l10n = (vscode as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message, args });
  }
  return format(message, args);
}

export type LlmStageOptions<T> = {
  stageId: string;
  promptVersion: number;
  events: ChatEvent[];
  prompt: string;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  responseSchema: LlmResponseSchema;
  maxTopics: number;
  maxItemsPerTopic: number;
  heartbeatMessage: string;
  validate: (value: unknown) => T;
  /** Which pipeline run owns this stage (for Output timing logs). */
  pipelineKind?: PipelineKind;
  timingRunId?: string;
  /** Filled by runLlmStage: cache hit vs live LLM. */
  timingOut?: LlmStageTimingOut;
};

function computeStageCacheKey(
  opts: Pick<
    LlmStageOptions<unknown>,
    "stageId" | "promptVersion" | "events" | "prompt" | "modelHint" | "hostId"
  >,
  providerId: string
): string {
  const hash = createHash("sha256");
  hash.update(providerId);
  hash.update("\0");
  hash.update(opts.hostId ?? "cursor");
  hash.update("\0");
  hash.update(opts.stageId);
  hash.update("\0");
  hash.update(String(opts.promptVersion));
  hash.update("\0");
  hash.update(opts.modelHint ?? "");
  hash.update("\0");
  hash.update(JSON.stringify(opts.events));
  hash.update("\0");
  hash.update(opts.prompt);
  return hash.digest("hex");
}

async function readStageCache<T>(
  cacheDir: string,
  key: string,
  validate: (value: unknown) => T
): Promise<T | undefined> {
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return validate(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

async function writeStageCache<T>(
  cacheDir: string,
  key: string,
  value: T
): Promise<void> {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

export async function runLlmStage<T>(
  opts: LlmStageOptions<T>,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<T> {
  if (!opts.events.length && opts.stageId.startsWith("session-")) {
    throw new LlmProviderError("empty", "Transcript has no events");
  }

  const cacheKey = computeStageCacheKey(opts, provider.id);
  const useCache = opts.cache && !!opts.cacheDir;

  if (useCache && opts.cacheDir) {
    const cached = await readStageCache(opts.cacheDir, cacheKey, opts.validate);
    if (cached) {
      progress?.report(safeT("ui.llm.cacheHit", "LLM cache hit…"));
      if (opts.timingOut) {
        opts.timingOut.cacheHit = true;
      }
      return cached;
    }
  }

  if (opts.timingOut) {
    opts.timingOut.cacheHit = false;
  }

  const heartbeat = createHeartbeat(progress, opts.heartbeatMessage);
  try {
    const result = await provider.summarize(
      {
        events: opts.events,
        prompt: opts.prompt,
        model: opts.modelHint,
        maxTopics: opts.maxTopics,
        maxItemsPerTopic: opts.maxItemsPerTopic,
        responseSchema: opts.responseSchema,
        onAttempt: (attempt, maxAttempts) => {
          if (attempt > 1) {
            progress?.report(
              safeT("ui.llm.attempt", "LLM attempt {0}/{1}…", attempt, maxAttempts)
            );
          }
        },
      },
      signal
    );
    const validated = opts.validate(result as LlmSummarizeResult);
    if (useCache && opts.cacheDir) {
      await writeStageCache(opts.cacheDir, cacheKey, validated);
    }
    return validated;
  } finally {
    heartbeat.stop();
  }
}

export const __testing = { computeStageCacheKey };
