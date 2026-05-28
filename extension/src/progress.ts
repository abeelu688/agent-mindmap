import type * as vscode from "vscode";

export type MindMapProgress = {
  report(message: string): void;
};

export function createProgressReporter(
  vscodeProgress: vscode.Progress<{ message?: string }>
): MindMapProgress {
  return {
    report(message: string) {
      vscodeProgress.report({ message });
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
    progress.report(`${baseMessage}（已等待 ${secs} 秒）`);
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
