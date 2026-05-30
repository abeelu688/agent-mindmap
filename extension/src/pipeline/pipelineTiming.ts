import * as fs from "fs/promises";
import * as path from "path";
import { mindMapLog } from "../webview/MindMapLog";

export type PipelineKind = "session" | "merge";

export type PipelineTimingEntry = {
  ts: number;
  runId: string;
  pipeline: PipelineKind;
  stage: string;
  durationMs: number;
  meta?: Record<string, unknown>;
};

export type PipelineTimingCollector = {
  runId: string;
  pipeline: PipelineKind;
  context: Record<string, unknown>;
  entries: PipelineTimingEntry[];
  storeDir?: string;
  time<T>(
    stage: string,
    fn: () => Promise<T> | T,
    meta?: Record<string, unknown> | (() => Record<string, unknown>)
  ): Promise<T>;
  finish(): Promise<void>;
};

const RUN_ID_BYTES = 6;

function randomRunId(): string {
  return Math.random().toString(36).slice(2, 2 + RUN_ID_BYTES);
}

export function formatDurationMs(ms: number): string {
  if (ms < 1) {
    return "<1ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || !Object.keys(meta).length) {
    return "";
  }
  const parts: string[] = [];
  if (meta.cacheHit === true) {
    parts.push("cache");
  }
  if (meta.skipped === true) {
    parts.push("skipped");
  }
  if (typeof meta.sessionId === "string") {
    parts.push(`session=${meta.sessionId}`);
  }
  if (typeof meta.kind === "string") {
    parts.push(meta.kind);
  }
  for (const [k, v] of Object.entries(meta)) {
    if (k === "cacheHit" || k === "skipped" || k === "sessionId" || k === "kind") {
      continue;
    }
    if (v === undefined || v === null) {
      continue;
    }
    parts.push(`${k}=${String(v)}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function contextLabel(context: Record<string, unknown>): string {
  const sessionId = context.sessionId;
  const projectSlug = context.projectSlug;
  const parts: string[] = [];
  if (typeof sessionId === "string") {
    parts.push(`session=${sessionId}`);
  }
  if (typeof projectSlug === "string") {
    parts.push(`project=${projectSlug}`);
  }
  if (typeof context.sessionCount === "number") {
    parts.push(`sessions=${context.sessionCount}`);
  }
  return parts.join(" ");
}

async function appendTimingNdjson(
  storeDir: string | undefined,
  entry: PipelineTimingEntry
): Promise<void> {
  if (!storeDir) {
    return;
  }
  try {
    const dir = path.join(storeDir, "logs");
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
      path.join(dir, "pipeline-timing.ndjson"),
      `${JSON.stringify(entry)}\n`,
      "utf8"
    );
  } catch {
    // best-effort
  }
}

function logStageLine(
  pipeline: PipelineKind,
  runId: string,
  stage: string,
  durationMs: number,
  meta?: Record<string, unknown>
): void {
  mindMapLog(
    `[pipeline:${pipeline}] run=${runId} ${stage} ${formatDurationMs(durationMs)}${formatMeta(meta)}`
  );
}

export function createPipelineTimingCollector(
  pipeline: PipelineKind,
  context: Record<string, unknown> = {},
  storeDir?: string
): PipelineTimingCollector {
  const runId = randomRunId();
  const entries: PipelineTimingEntry[] = [];

  mindMapLog(
    `[pipeline:${pipeline}] run=${runId} start ${contextLabel(context)}`.trim()
  );

  return {
    runId,
    pipeline,
    context,
    entries,
    storeDir,
    async time<T>(
      stage: string,
      fn: () => Promise<T> | T,
      meta?: Record<string, unknown> | (() => Record<string, unknown>)
    ): Promise<T> {
      const started = performance.now();
      try {
        return await fn();
      } finally {
        const durationMs = performance.now() - started;
        const resolvedMeta =
          typeof meta === "function" ? meta() : meta;
        const entry: PipelineTimingEntry = {
          ts: Date.now(),
          runId,
          pipeline,
          stage,
          durationMs,
          meta: resolvedMeta,
        };
        entries.push(entry);
        logStageLine(pipeline, runId, stage, durationMs, resolvedMeta);
        await appendTimingNdjson(storeDir, entry);
      }
    },
    async finish(): Promise<void> {
      const totalMs = entries.reduce((sum, e) => sum + e.durationMs, 0);
      const ctx = contextLabel(context);
      mindMapLog(
        `[pipeline:${pipeline}] run=${runId} finish total=${formatDurationMs(totalMs)}${ctx ? ` ${ctx}` : ""}`
      );
      if (entries.length > 1) {
        const breakdown = entries
          .map((e) => `${e.stage}=${formatDurationMs(e.durationMs)}`)
          .join(", ");
        mindMapLog(`[pipeline:${pipeline}] run=${runId} breakdown ${breakdown}`);
      }
      await appendTimingNdjson(storeDir, {
        ts: Date.now(),
        runId,
        pipeline,
        stage: "__summary__",
        durationMs: totalMs,
        meta: {
          ...context,
          stages: entries.map((e) => ({
            stage: e.stage,
            durationMs: Math.round(e.durationMs),
            meta: e.meta,
          })),
        },
      });
    },
  };
}

/** Standalone stage log (e.g. M4 per-session S4 inside reorganize). */
export function logPipelineStageTiming(
  pipeline: PipelineKind,
  stage: string,
  durationMs: number,
  meta?: Record<string, unknown> & { runId?: string; storeDir?: string }
): void {
  const runId = meta?.runId ?? "llm";
  const { storeDir, ...rest } = meta ?? {};
  logStageLine(pipeline, runId, stage, durationMs, rest);
  void appendTimingNdjson(storeDir, {
    ts: Date.now(),
    runId,
    pipeline,
    stage,
    durationMs,
    meta: rest,
  });
}

export const __testing = { formatDurationMs, formatMeta };
