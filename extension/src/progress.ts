import type * as vscode from "vscode";
import * as vs from "vscode";

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
  const l10n = (vs as unknown as { l10n?: { t?: Function } }).l10n;
  const fn = l10n?.t as
    | undefined
    | ((opts: { key: string; message: string; args?: unknown[] }) => string);
  if (fn) {
    return fn({ key, message, args });
  }
  return format(message, args);
}

export type MindMapProgressUpdate =
  | string
  | { message?: string; increment?: number };

export type MindMapProgress = {
  report(update: MindMapProgressUpdate): void;
};

function resolveProgressMessage(update: MindMapProgressUpdate): string | undefined {
  if (typeof update === "string") {
    return update;
  }
  return update.message;
}

export function createProgressReporter(
  vscodeProgress: vscode.Progress<{ message?: string; increment?: number }>
): MindMapProgress {
  return {
    report(update: MindMapProgressUpdate) {
      if (typeof update === "string") {
        vscodeProgress.report({ message: update });
        return;
      }
      vscodeProgress.report(update);
    },
  };
}

function truncateLabel(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) {
    return t;
  }
  return t.slice(0, maxLen - 1) + "…";
}

/**
 * Prefixes per-step messages with batch position so long LLM steps still show x/N.
 */
export function createBatchItemProgress(
  parent: MindMapProgress | undefined,
  index: number,
  total: number,
  sessionLabel: string
): {
  progress: MindMapProgress;
  reportComplete: (detail: string) => void;
} {
  const position = safeT(
    "ui.progress.batch.position",
    "第 {0}/{1} 条",
    index + 1,
    total
  );
  const header = safeT(
    "ui.progress.batch.header",
    "{0} · {1}",
    position,
    truncateLabel(sessionLabel, 40)
  );

  return {
    progress: {
      report(update: MindMapProgressUpdate) {
        const step = resolveProgressMessage(update);
        if (!step) {
          if (typeof update !== "string" && update.increment !== undefined) {
            parent?.report(update);
          }
          return;
        }
        parent?.report(`${header} — ${step}`);
      },
    },
    reportComplete(detail: string) {
      const increment = total > 0 ? 100 / total : 0;
      parent?.report({
        message: safeT(
          "ui.progress.batch.complete",
          "{0} · {1}（已完成 {2}/{3}）",
          position,
          detail,
          index + 1,
          total
        ),
        increment,
      });
    },
  };
}

export type ProgressHeartbeat = {
  stop(): void;
};

/**
 * Periodically updates progress with elapsed seconds while a long-running step
 * (e.g. LLM CLI) has no finer-grained events.
 */
export function createHeartbeat(
  progress: MindMapProgress | undefined,
  baseMessage: string,
  intervalMs = 3000
): ProgressHeartbeat {
  if (!progress) {
    return { stop() {} };
  }
  const started = Date.now();
  progress.report(baseMessage);
  const timer = setInterval(() => {
    const secs = Math.floor((Date.now() - started) / 1000);
    progress.report(
      safeT(
        "ui.progress.heartbeat.wait",
        "{0}（已等待 {1} 秒）",
        baseMessage,
        secs
      )
    );
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}

/** No-op progress for call sites that do not need UI updates. */
export const noopProgress: MindMapProgress = {
  report() {},
};
