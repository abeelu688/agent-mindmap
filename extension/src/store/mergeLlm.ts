import type { AgentHostId } from "../host/types";
import * as vscode from "vscode";
import type { MindMapProgress } from "../progress";
import { createHeartbeat } from "../progress";
import { buildMergePrompt, MERGE_PROMPT_VERSION } from "../llm/promptMerge";
import { PROMPT_VERSION } from "../llm/promptOutline";
import {
  LlmProviderError,
  type LlmProvider,
  type MergedOutline,
} from "../llm/types";
import type { PromptLanguage } from "../llm/promptLanguage";
import { buildMergedOutlineMindMap } from "../mindmap/buildMergedOutlineMindMap";
import type { MindMapRoot } from "../transcript/types";
import {
  llmMergeCachePath,
  llmRefinedMergePath,
  readMergeRecord,
  sha256Hex,
  writeMergeRecord,
} from "./sessionStore";
import type { MergeRecord, SessionRecord } from "./storeTypes";

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

export type MergeLlmOptions = {
  maxTopics: number;
  maxItemsPerTopic: number;
  /** Override the merged mind-map root label. */
  title?: string;
  /** Model hint, propagated to provider and folded into the cache key. */
  model?: string;
  hostId?: AgentHostId;
  promptLanguage?: PromptLanguage;
};

/**
 * Cache key = sha256 of:
 *   - sorted session ids
 *   - prompt parameters + schema version
 *   - provider id + model
 */
export function computeMergeCacheKey(
  records: SessionRecord[],
  opts: MergeLlmOptions,
  providerId: string
): string {
  const sortedIds = records.map((r) => r.meta.sessionId).sort();
  const payload = JSON.stringify({
    sessionIds: sortedIds,
    promptParams: {
      maxTopics: opts.maxTopics,
      maxItemsPerTopic: opts.maxItemsPerTopic,
    },
    promptVersion: MERGE_PROMPT_VERSION,
    outlineSchema: PROMPT_VERSION,
    promptLanguage: opts.promptLanguage ?? "zh",
    provider: providerId,
    model: opts.model?.trim() || "",
  });
  return sha256Hex(payload);
}

function projectSlugsFor(records: SessionRecord[]): string[] {
  return Array.from(new Set(records.map((r) => r.meta.projectSlug))).sort();
}

function buildRefinedMindMap(
  merged: MergedOutline,
  records: SessionRecord[],
  rootTitleOverride?: string
): MindMapRoot {
  return buildMergedOutlineMindMap(merged, records, rootTitleOverride);
}

/**
 * Run an LLM merge across the given session records (using persisted outlines).
 */
export async function mergeWithLlm(
  records: SessionRecord[],
  opts: MergeLlmOptions,
  provider: LlmProvider,
  storeDir: string,
  signal: AbortSignal,
  progress?: MindMapProgress
): Promise<MergeRecord> {
  if (!records.length) {
    throw new LlmProviderError("empty", "No sessions selected to merge");
  }

  progress?.report(safeT("ui.merge.cache.check", "Checking merge cache…"));
  const cacheKey = computeMergeCacheKey(records, opts, provider.id);
  const cacheFile = llmMergeCachePath(storeDir, cacheKey);
  const cached = await readMergeRecord(cacheFile);
  if (cached) {
    progress?.report(
      safeT("ui.merge.cache.hitRender", "Merge cache hit, generating mind map…")
    );
    await writeMergeRecord(llmRefinedMergePath(storeDir), cached);
    return cached;
  }

  const hostId =
    opts.hostId ?? records[0]?.meta.hostId ?? "cursor";
  const prompt = buildMergePrompt(
    records,
    {
      maxTopics: opts.maxTopics,
      maxItemsPerTopic: opts.maxItemsPerTopic,
    },
    hostId,
    opts.promptLanguage ?? "zh"
  );

  const heartbeat = createHeartbeat(
    progress,
    safeT("ui.merge.llm.heartbeat", "Calling LLM to merge topics…")
  );
  let result: Awaited<ReturnType<LlmProvider["summarize"]>>;
  try {
    result = await provider.summarize(
      {
        events: [],
        prompt,
        model: opts.model,
        maxTopics: opts.maxTopics,
        maxItemsPerTopic: opts.maxItemsPerTopic,
        responseSchema: "merged-outline",
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
  } finally {
    heartbeat.stop();
  }

  if (!result || typeof result !== "object" || !("outline" in result)) {
    throw new LlmProviderError("bad-shape", "Provider did not return MergedOutline");
  }
  const merged = result as MergedOutline;

  progress?.report(safeT("ui.progress.renderMindMap", "Rendering mind map…"));
  const mindMap = buildRefinedMindMap(
    merged,
    records,
    opts.title ?? merged.title
  );
  const record: MergeRecord = {
    schemaVersion: 1,
    meta: {
      kind: "llm-refined",
      builtAt: Date.now(),
      sessionIds: records.map((r) => r.meta.sessionId),
      projectSlugs: projectSlugsFor(records),
      llm: {
        provider: provider.id,
        model: opts.model?.trim() || undefined,
      },
      title:
        typeof mindMap.data.text === "string" ? mindMap.data.text : undefined,
    },
    mindMap,
  };

  progress?.report(safeT("ui.merge.cache.write", "Writing merge cache…"));
  await writeMergeRecord(cacheFile, record);
  await writeMergeRecord(llmRefinedMergePath(storeDir), record);
  return record;
}
