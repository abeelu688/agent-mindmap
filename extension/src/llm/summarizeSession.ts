import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { buildOutlinePrompt, type OutlinePromptOptions } from "./promptOutline";
import { validateSessionOutline } from "./outlineValidate";
import type { MindMapProgress } from "../progress";
import { createHeartbeat } from "../progress";
import {
  LlmProviderError,
  type LlmProvider,
  type SessionOutline,
} from "./types";
import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import type { PromptLanguage } from "./promptLanguage";
import { format, t as safeT } from "../l10n/uiTranslate";

export type SummarizeOptions = {
  prompt: OutlinePromptOptions;
  modelHint?: string;
  cacheDir?: string;
  cache: boolean;
  hostId?: AgentHostId;
  promptLanguage?: PromptLanguage;
};

function computeCacheKey(
  events: ChatEvent[],
  opts: SummarizeOptions,
  providerId: string,
  prompt: string
): string {
  const hash = createHash("sha256");
  hash.update(providerId);
  hash.update("\0");
  hash.update(opts.hostId ?? "cursor");
  hash.update("\0");
  hash.update(JSON.stringify(opts.prompt));
  hash.update("\0");
  hash.update(opts.modelHint ?? "");
  hash.update("\0");
  hash.update(JSON.stringify(events));
  hash.update("\0");
  hash.update(prompt);
  hash.update("\0outline-v6");
  return hash.digest("hex");
}

async function readCache(
  cacheDir: string,
  key: string
): Promise<SessionOutline | undefined> {
  const file = path.join(cacheDir, `${key}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return validateSessionOutline(parsed);
  } catch {
    return undefined;
  }
}

async function writeCache(
  cacheDir: string,
  key: string,
  outline: SessionOutline
): Promise<void> {
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    const file = path.join(cacheDir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(outline, null, 2), "utf8");
  } catch {
    // cache is best-effort
  }
}

export async function summarizeSession(
  events: ChatEvent[],
  opts: SummarizeOptions,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<SessionOutline> {
  if (!events.length) {
    throw new LlmProviderError("empty", "Transcript has no events to summarize");
  }

  const prompt = buildOutlinePrompt(
    events,
    opts.prompt,
    opts.hostId ?? "cursor",
    opts.promptLanguage ?? "zh"
  );
  const cacheKey = computeCacheKey(events, opts, provider.id, prompt);
  const useCache = opts.cache && !!opts.cacheDir;

  if (useCache && opts.cacheDir) {
    const cached = await readCache(opts.cacheDir, cacheKey);
    if (cached) {
      progress?.report(safeT("ui.llm.cacheHit", "LLM cache hit…"));
      return cached;
    }
  }

  const heartbeat = createHeartbeat(
    progress,
    safeT("ui.llm.outline.heartbeat", "Generating outline…")
  );
  try {
    const result = await provider.summarize(
      {
        events,
        prompt,
        model: opts.modelHint,
        maxTopics: opts.prompt.maxBranches,
        maxItemsPerTopic: opts.prompt.maxDetailsPerNode,
        responseSchema: "session-outline",
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

    if (!result || typeof result !== "object" || !("outline" in result)) {
      throw new LlmProviderError(
        "bad-shape",
        "Provider did not return SessionOutline"
      );
    }
    const outline = result as SessionOutline;

    if (useCache && opts.cacheDir) {
      await writeCache(opts.cacheDir, cacheKey, outline);
    }

    return outline;
  } finally {
    heartbeat.stop();
  }
}

export const __testing = { computeCacheKey };
