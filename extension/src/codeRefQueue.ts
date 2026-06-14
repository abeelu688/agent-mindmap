import { mindMapLog } from "./webview/MindMapLog";
import { agentLog } from "./log";
import { MindMapPanel } from "./webview/MindMapPanel";
import { readRecord, writeRecord } from "./store/sessionStore";
import { buildOutlineMindMap } from "./mindmap/buildOutlineMindMap";
import { extractCodeReferencesFromEvents } from "./llm/extractCodeReferences";
import { getLastBatchStatus, setLastBatchStatus, setPendingMindMap } from "./batch/batchStatus";
import { notifyInfo } from "./notify";
import { t } from "./l10n/uiTranslate";
import { LlmProviderError } from "./llm/types";
import { mindMapLabelsForOutputLanguage } from "./mindmap/outputLanguageLabels";
import type { ChatEvent } from "./transcript/types";
import type { CodeReference, LlmProvider, SessionOutline } from "./llm/types";
import type { OutputLanguage } from "./llm/promptLanguage";
import type { SessionMeta } from "./mindmap/origin";
import type { MindMapRoot } from "./transcript/types";

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
};

const queue: CodeRefQueueItem[] = [];
let running = false;

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

export function enqueueCodeRefUpdate(item: CodeRefQueueItem): void {
  // Replace any existing pending item for the same session (deduplicate)
  const idx = queue.findIndex((q) => q.sessionId === item.sessionId);
  if (idx >= 0) {
    queue[idx] = item;
  } else {
    queue.push(item);
  }
  processNext();
}

function processNext(): void {
  if (running || queue.length === 0) {
    return;
  }
  running = true;
  const item = queue.shift()!;
  runItem(item).finally(() => {
    running = false;
    processNext();
  });
}

function isSameSingleSessionMap(
  mindMap: MindMapRoot | undefined,
  projectSlug: string,
  sessionId: string
): boolean {
  const refs = mindMap?.data.origin?.refs;
  return Boolean(
    refs?.length &&
    refs.every((ref) => ref.projectSlug === projectSlug && ref.sessionId === sessionId)
  );
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
  return refs.map((ref) => ({
    ...ref,
    llmStatus: "failed" as const,
    llmUpdatedAt: now,
    llmError: message.slice(0, 200),
  }));
}

async function runItem(item: CodeRefQueueItem): Promise<void> {
  mindMapLog(
    `[codeRefQueue] start session=${item.sessionId.slice(0, 8)} queue_remaining=${queue.length}`
  );
  const signal = AbortSignal.timeout(item.timeoutMs);

  let doneRefs: CodeReference[] | undefined;
  try {
    const refs = await extractCodeReferencesFromEvents(item.events, item.provider, signal, {
      projectPath: item.projectPath,
      model: item.model,
      cacheDir: item.cacheDir,
      cache: item.cache,
      outline: item.outline,
      timeoutMs: item.timeoutMs,
      outputLanguage: item.outputLanguage,
    });

    if (!refs?.length) {
      mindMapLog(
        `[codeRefQueue] no refs returned session=${item.sessionId.slice(0, 8)}, skipping update`
      );
      return;
    }
    doneRefs = markCodeRefsDone(refs);
  } catch (err) {
    agentLog.warn(`[codeRefQueue] LLM failed session=${item.sessionId.slice(0, 8)}`, {
      error: String(err),
    });
    // On cancellation (extension reload / user cancel), do NOT overwrite stored refs —
    // they will be retried on the next load as long as they stay "pending" or "failed".
    // Overwriting on cancel could corrupt "done" refs from a prior successful run.
    const isCancelled = err instanceof LlmProviderError && err.code === "cancelled";
    if (isCancelled) {
      mindMapLog(
        `[codeRefQueue] cancelled session=${item.sessionId.slice(0, 8)}, skipping status write`
      );
      return;
    }
    // Persist failed status so next load can retry
    try {
      const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
      if (latest?.sessionAnalysis) {
        const failed = markCodeRefsFailed(latest.sessionAnalysis.codeReferences, err);
        latest.sessionAnalysis.codeReferences = failed?.length ? failed : undefined;
        await writeRecord(item.storeDir, latest);
      }
    } catch (writeErr) {
      agentLog.error("[codeRefQueue] failed to persist failure status", writeErr);
    }
    mindMapLog(
      `[codeRefQueue] failed session=${item.sessionId.slice(0, 8)} error=${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  // Persist done refs
  try {
    const latest = await readRecord(item.storeDir, item.projectSlug, item.sessionId);
    if (!latest?.sessionAnalysis) {
      return;
    }
    latest.sessionAnalysis.codeReferences = doneRefs;
    await writeRecord(item.storeDir, latest);

    mindMapLog(`[codeRefQueue] done session=${item.sessionId.slice(0, 8)} refs=${doneRefs.length}`);

    // Notify panel only when it's showing this exact single-session map
    const panel = MindMapPanel.getCurrent();
    if (panel && isSameSingleSessionMap(panel.getMindMapData(), item.projectSlug, item.sessionId)) {
      const sessionMeta: SessionMeta = {
        sessionId: item.sessionId,
        projectSlug: item.projectSlug,
        projectPath: item.projectPath,
        sessionLabel: item.sessionLabel,
        transcriptPath: item.transcriptPath,
      };
      const labels = mindMapLabelsForOutputLanguage(item.outputLanguage);
      setPendingMindMap(
        buildOutlineMindMap(
          latest.outline,
          item.sessionLabel,
          sessionMeta,
          doneRefs,
          item.projectPath,
          item.outputLanguage
        ),
        undefined,
        labels.relatedCode
      );
      const currentStatus = getLastBatchStatus();
      const nextStatus = currentStatus
        ? { ...currentStatus, pendingUpdateLabel: labels.relatedCode }
        : {
            total: 1,
            processed: 1,
            analyzed: 1,
            cached: 0,
            failed: 0,
            batchNo: 0,
            running: false,
            pendingUpdateLabel: labels.relatedCode,
          };
      setLastBatchStatus(nextStatus);
      panel.setBatchStatus(nextStatus);
      notifyInfo(
        t(
          "ui.codeRefs.pendingRefresh",
          "Agent Mind Map: Code descriptions are ready. Click Refresh in the mind map to update."
        )
      );
    }
  } catch (writeErr) {
    agentLog.error("[codeRefQueue] failed to persist done refs", writeErr);
  }
}
