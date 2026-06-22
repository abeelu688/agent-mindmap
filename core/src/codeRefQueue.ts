/**
 * Code-reference background queue — processes code-reference description
 * generation via LLM, one item at a time with retries.
 *
 * Moved from extension/src/codeRefQueue.ts in P1.10.
 * All VS Code-specific operations (panel updates, notifications, progress UI,
 * store access, mind map rebuilds) are delegated through CodeRefQueueDeps.
 * Call `initCodeRefQueue(deps)` before using any queue operations.
 *
 * CLI: `drainCodeRefQueue()` is the key API — it resolves when the queue is
 * idle, so the CLI can await it before returning to the user.
 */
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { mindMapLabelsForOutputLanguage } from "./mindmap/outputLanguageLabels";
import { isRetryableError } from "./errors";
import { mergeAbortSignals } from "./ports/ProgressReporter";
import { LlmProviderError } from "./llm/types";
import type { CodeRefQueueDeps } from "./ports/CodeRefQueueDeps";
import type { ProgressReporter } from "./ports/ProgressReporter";
import type { ChatEvent } from "./transcript/types";
import type { CodeReference, LlmProvider, SessionOutline } from "./llm/types";
import type { OutputLanguage } from "./llm/promptLanguage";
import type { SessionMeta } from "./mindmap/origin";
import type { MindMapRoot } from "./transcript/types";

// ─── Module-level deps ──────────────────────────────────────────────────────

let deps: CodeRefQueueDeps | undefined;

/**
 * Initialize the code-ref queue with surface-layer dependencies.
 * Must be called before any queue operations (matches setCoreLogger pattern).
 */
export function initCodeRefQueue(d: CodeRefQueueDeps): void {
  deps = d;
}

function requireDeps(): CodeRefQueueDeps {
  if (!deps) {
    throw new Error("codeRefQueue: initCodeRefQueue() has not been called");
  }
  return deps;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

export type CodeRefPanelNotifyKind = "single" | "merged" | "none";

export function getProjectSessionIdsOnMap(
  mindMap: MindMapRoot | undefined,
  projectSlug: string
): Set<string> {
  const refs = mindMap?.data.origin?.refs;
  if (!refs?.length) {
    return new Set();
  }
  return new Set(refs.filter((ref) => ref.projectSlug === projectSlug).map((ref) => ref.sessionId));
}

export function resolveCodeRefPanelNotifyKind(
  mindMap: MindMapRoot | undefined,
  projectSlug: string,
  sessionId: string
): CodeRefPanelNotifyKind {
  const sessionIds = getProjectSessionIdsOnMap(mindMap, projectSlug);
  if (!sessionIds.has(sessionId)) {
    return "none";
  }
  return sessionIds.size === 1 ? "single" : "merged";
}

function truncateSessionLabel(text: string, maxLen = 40): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(0, maxLen - 1) + "…";
}

function codeRefProgressTitle(): string {
  return "Agent Mind Map: Generating code descriptions…";
}

function codeRefProgressInitialMessage(item: CodeRefQueueItem, queueRemaining: number): string {
  const sessionShort = truncateSessionLabel(item.sessionLabel);
  const attempt = normalizeAttempt(item.attempt);
  const base =
    attempt > 1 ? `Retry ${attempt}/${CODE_REF_MAX_ATTEMPTS} · ${sessionShort}` : sessionShort;
  if (queueRemaining > 0) {
    return `${base} — ${queueRemaining} more in queue`;
  }
  return base;
}

function wrapCodeRefProgress(
  parent: ProgressReporter,
  item: CodeRefQueueItem,
  queueRemaining: number
): ProgressReporter {
  const header = codeRefProgressInitialMessage(item, queueRemaining);
  return {
    report(update) {
      const step = typeof update === "string" ? update : update.message;
      if (!step) {
        if (typeof update !== "string" && update.increment !== undefined) {
          parent.report(update);
        }
        return;
      }
      publishCodeRefPanelStatus({
        active: true,
        sessionLabel: truncateSessionLabel(item.sessionLabel),
        message: step,
        queueRemaining,
      });
      parent.report(`${header} — ${step}`);
    },
  };
}

type CodeRefPanelStatusUpdate = {
  active: boolean;
  sessionLabel?: string;
  message?: string;
  queueRemaining?: number;
};

function publishCodeRefPanelStatus(update: CodeRefPanelStatusUpdate): void {
  requireDeps().onCodeRefPanelStatusUpdate?.(update);
}

function finishCodeRefPanelStatus(): void {
  if (queue.length > 0) {
    return;
  }
  publishCodeRefPanelStatus({ active: false });
  if (!running) {
    void flushAllDirtyCodeRefProjects();
  }
}

async function flushAllDirtyCodeRefProjects(): Promise<void> {
  for (const projectSlug of [...dirtyProjectItems.keys()]) {
    await flushPendingCodeRefRefreshForProject(projectSlug);
  }
}

function hasProjectOnMap(mindMap: MindMapRoot | undefined, projectSlug: string): boolean {
  return getProjectSessionIdsOnMap(mindMap, projectSlug).size > 0;
}

// ─── Queue item types ────────────────────────────────────────────────────────

export type CodeRefQueueItem = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  events: ChatEvent[];
  outline: SessionOutline;
  provider: LlmProvider;
  model?: string;
  cacheDir?: string;
  cache: boolean;
  timeoutMs: number;
  storeDir: string;
  outputLanguage?: OutputLanguage;
  /** 1-based attempt counter; defaults to 1 on first enqueue. */
  attempt?: number;
};

/** Total attempts per session code-ref LLM job (initial + retries). */
export const CODE_REF_MAX_ATTEMPTS = 3;

function normalizeAttempt(attempt?: number): number {
  return attempt ?? 1;
}

function mergeEnqueueAttempt(existing?: number, incoming?: number): number {
  return Math.max(normalizeAttempt(existing), normalizeAttempt(incoming));
}

function shouldScheduleCodeRefRetry(err: unknown, attempt: number): boolean {
  if (err instanceof LlmProviderError && err.code === "cancelled") {
    return false;
  }
  return attempt < CODE_REF_MAX_ATTEMPTS && isRetryableError(err);
}

// ─── Queue state ──────────────────────────────────────────────────────────────

const queue: CodeRefQueueItem[] = [];
const dirtyProjectItems = new Map<string, CodeRefQueueItem>();
let running = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/** Wait until the background code-reference queue is idle (for headless scripts). */
export function drainCodeRefQueue(): Promise<void> {
  return new Promise((resolve) => {
    const tick = (): void => {
      if (!running && queue.length === 0) {
        resolve();
        return;
      }
      setTimeout(tick, 25);
    };
    tick();
  });
}

/** Drop queued code-ref jobs for a project (e.g. before force re-analyze). */
export function purgeCodeRefQueueForProject(projectSlug: string): number {
  let removed = 0;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i]!.projectSlug === projectSlug) {
      queue.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

export function enqueueCodeRefUpdate(item: CodeRefQueueItem): void {
  enqueueCodeRefItemOnly(item);
  processNext();
}

function enqueueCodeRefItemOnly(item: CodeRefQueueItem): void {
  const attempt = normalizeAttempt(item.attempt);
  const idx = queue.findIndex((q) => q.sessionId === item.sessionId);
  if (idx >= 0) {
    const existing = queue[idx]!;
    queue[idx] = { ...item, attempt: mergeEnqueueAttempt(existing.attempt, attempt) };
  } else {
    queue.push({ ...item, attempt });
  }
}

function processNext(): void {
  if (running || queue.length === 0) {
    return;
  }
  running = true;
  const item = queue.shift()!;
  setImmediate(() => {
    void runItem(item).finally(() => {
      running = false;
      processNext();
    });
  });
}

function markCodeRefsDone(refs: CodeReference[]): CodeReference[] {
  const now = Date.now();
  return refs.map((ref) => ({
    ...ref,
    llmStatus: "done" as const,
    llmUpdatedAt: now,
    llmError: undefined,
  }));
}

function markCodeRefsFailed(
  refs: CodeReference[] | undefined,
  err: unknown
): CodeReference[] | undefined {
  if (!refs?.length) {
    return refs;
  }
  const now = Date.now();
  const message = err instanceof Error ? err.message : String(err);
  return refs.map((ref) =>
    ref.llmStatus === "done"
      ? ref
      : {
          ...ref,
          llmStatus: "failed" as const,
          llmUpdatedAt: now,
          llmError: message.slice(0, 200),
        }
  );
}

// ─── Notification helpers (use deps) ─────────────────────────────────────────

async function notifyCodeRefMapUpdate(
  item: CodeRefQueueItem,
  outline: SessionOutline,
  codeRefs: CodeReference[]
): Promise<void> {
  const d = requireDeps();
  const currentMap = d.getCurrentMindMap?.();
  const pendingMap = d.getPendingMindMap?.();
  const currentNotifyKind = resolveCodeRefPanelNotifyKind(
    currentMap,
    item.projectSlug,
    item.sessionId
  );
  const pendingNotifyKind = resolveCodeRefPanelNotifyKind(
    pendingMap,
    item.projectSlug,
    item.sessionId
  );
  const notifyKind = currentNotifyKind !== "none" ? currentNotifyKind : pendingNotifyKind;
  const labels = mindMapLabelsForOutputLanguage(item.outputLanguage);

  if (notifyKind === "none") {
    if (
      hasProjectOnMap(currentMap, item.projectSlug) ||
      hasProjectOnMap(pendingMap, item.projectSlug)
    ) {
      const mergedMap = await d.rebuildProjectMerge(item.storeDir, item.projectSlug);
      if (mergedMap) {
        d.onPendingCodeRefRefresh?.(mergedMap, labels.relatedCode);
        return;
      }
    }
    dirtyProjectItems.set(item.projectSlug, item);
    return;
  }

  let pendingResult: MindMapRoot | undefined;
  if (notifyKind === "single") {
    const sessionMeta: SessionMeta = {
      sessionId: item.sessionId,
      projectSlug: item.projectSlug,
      projectPath: item.projectPath,
      sessionLabel: item.sessionLabel,
      transcriptPath: item.transcriptPath,
    };
    pendingResult = buildOutlineMindMap(
      outline,
      item.sessionLabel,
      sessionMeta,
      codeRefs,
      item.projectPath,
      item.outputLanguage
    );
  } else {
    // rebuildProjectMerge in the adapter handles the store write internally
    pendingResult = await d.rebuildProjectMerge(item.storeDir, item.projectSlug);
  }

  if (!pendingResult) {
    return;
  }

  d.onPendingCodeRefRefresh?.(pendingResult, labels.relatedCode);
}

async function persistAndNotifyPartialCodeRefs(
  item: CodeRefQueueItem,
  codeRefs: CodeReference[],
  outline: SessionOutline
): Promise<void> {
  const d = requireDeps();
  const store = await d.getStore(item.storeDir);
  const latest = await store.getRecord(item.projectSlug, item.sessionId);
  if (!latest?.sessionAnalysis) {
    return;
  }
  latest.sessionAnalysis.codeReferences = codeRefs;
  await store.upsertRecord(latest);
  const doneCount = codeRefs.filter((ref) => ref.llmStatus === "done").length;
  const pendingCount = codeRefs.filter((ref) => ref.llmStatus === "pending").length;
  d.logInfo(
    `[codeRefQueue] partial session=${item.sessionId.slice(0, 8)} done=${doneCount} pending=${pendingCount}`
  );
  await notifyCodeRefMapUpdate(item, outline, codeRefs);
}

export async function flushPendingCodeRefRefreshForProject(projectSlug: string): Promise<void> {
  const d = requireDeps();
  const item = dirtyProjectItems.get(projectSlug);
  const currentMap = d.getCurrentMindMap?.();
  const pendingMap = d.getPendingMindMap?.();
  if (!item) {
    return;
  }
  if (!hasProjectOnMap(currentMap, projectSlug) && !hasProjectOnMap(pendingMap, projectSlug)) {
    return;
  }
  const mergedMap = await d.rebuildProjectMerge(item.storeDir, item.projectSlug);
  if (mergedMap) {
    const labels = mindMapLabelsForOutputLanguage(item.outputLanguage);
    d.onPendingCodeRefRefresh?.(mergedMap, labels.relatedCode);
  }
}

// ─── Item runner ──────────────────────────────────────────────────────────────

async function runItem(item: CodeRefQueueItem): Promise<void> {
  const d = requireDeps();
  const attempt = normalizeAttempt(item.attempt);
  d.logInfo(
    `[codeRefQueue] start session=${item.sessionId.slice(0, 8)} attempt=${attempt}/${CODE_REF_MAX_ATTEMPTS} queue_remaining=${queue.length}`
  );

  publishCodeRefPanelStatus({
    active: true,
    sessionLabel: truncateSessionLabel(item.sessionLabel),
    queueRemaining: queue.length,
  });

  let doneRefs: CodeReference[] | undefined;
  try {
    const refs = await d.withCancellableProgress(
      codeRefProgressTitle(),
      codeRefProgressInitialMessage(item, queue.length),
      async ({ progress, signal: cancelSignal }) => {
        const signal = mergeAbortSignals(AbortSignal.timeout(item.timeoutMs), cancelSignal);
        // Import extractCodeReferencesFromEvents lazily to avoid circular deps at module load
        const { extractCodeReferencesFromEvents } = await import("./llm/extractCodeReferences");
        return extractCodeReferencesFromEvents(
          item.events,
          item.provider,
          signal,
          {
            projectPath: item.projectPath,
            model: item.model,
            cacheDir: item.cacheDir,
            cache: item.cache,
            outline: item.outline,
            timeoutMs: item.timeoutMs,
            outputLanguage: item.outputLanguage,
            onBatchComplete: async (batch) => {
              await persistAndNotifyPartialCodeRefs(item, batch.snapshotRefs, item.outline);
            },
          },
          wrapCodeRefProgress(progress, item, queue.length)
        );
      }
    );

    if (refs === undefined) {
      d.logInfo(
        `[codeRefQueue] cancelled session=${item.sessionId.slice(0, 8)}, skipping status write`
      );
      finishCodeRefPanelStatus();
      return;
    }

    if (!refs.length) {
      d.logInfo(
        `[codeRefQueue] no refs returned session=${item.sessionId.slice(0, 8)}, skipping update`
      );
      finishCodeRefPanelStatus();
      return;
    }
    doneRefs = markCodeRefsDone(refs);
  } catch (err) {
    d.logWarn(`[codeRefQueue] LLM failed session=${item.sessionId.slice(0, 8)}`, {
      error: String(err),
    });
    // On cancellation, do NOT overwrite stored refs —
    // they will be retried on the next load as long as they stay "pending" or "failed".
    const isCancelled = err instanceof LlmProviderError && err.code === "cancelled";
    if (isCancelled) {
      d.logInfo(
        `[codeRefQueue] cancelled session=${item.sessionId.slice(0, 8)}, skipping status write`
      );
      finishCodeRefPanelStatus();
      return;
    }
    if (shouldScheduleCodeRefRetry(err, attempt)) {
      enqueueCodeRefUpdate({ ...item, attempt: attempt + 1 });
      d.logInfo(
        `[codeRefQueue] retry session=${item.sessionId.slice(0, 8)} attempt=${attempt + 1}/${CODE_REF_MAX_ATTEMPTS}`
      );
      finishCodeRefPanelStatus();
      return;
    }
    // Persist failed status so next load can retry on a later session open
    try {
      const store = await d.getStore(item.storeDir);
      const latest = await store.getRecord(item.projectSlug, item.sessionId);
      if (latest?.sessionAnalysis) {
        const failed = markCodeRefsFailed(latest.sessionAnalysis.codeReferences, err);
        latest.sessionAnalysis.codeReferences = failed?.length ? failed : undefined;
        await store.upsertRecord(latest);
      }
    } catch (writeErr) {
      d.logError("[codeRefQueue] failed to persist failure status", writeErr);
    }
    d.logInfo(
      `[codeRefQueue] failed session=${item.sessionId.slice(0, 8)} error=${err instanceof Error ? err.message : String(err)}`
    );
    finishCodeRefPanelStatus();
    return;
  }

  // Persist done refs (final snapshot; last batch already notified incrementally)
  try {
    const store = await d.getStore(item.storeDir);
    const latest = await store.getRecord(item.projectSlug, item.sessionId);
    if (!latest?.sessionAnalysis) {
      finishCodeRefPanelStatus();
      return;
    }
    latest.sessionAnalysis.codeReferences = doneRefs;
    await store.upsertRecord(latest);

    d.logInfo(`[codeRefQueue] done session=${item.sessionId.slice(0, 8)} refs=${doneRefs.length}`);

    await notifyCodeRefMapUpdate(item, latest.outline, doneRefs);
  } catch (writeErr) {
    d.logError("[codeRefQueue] failed to persist done refs", writeErr);
  } finally {
    finishCodeRefPanelStatus();
  }
}

// ─── Testing exports ─────────────────────────────────────────────────────────

export const __testingCodeRefQueue = {
  shouldScheduleCodeRefRetry,
  mergeEnqueueAttempt,
  normalizeAttempt,
  enqueueCodeRefItemOnly,
  codeRefProgressInitialMessage,
  markCodeRefsFailed,
  getQueueSnapshot: (): ReadonlyArray<CodeRefQueueItem> => [...queue],
  resetQueueState: (): void => {
    queue.length = 0;
    dirtyProjectItems.clear();
    running = false;
  },
};
