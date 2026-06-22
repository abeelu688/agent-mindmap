/**
 * Core progress reporter — locale-free, no VS Code dependency.
 *
 * Replaces the extension's `MindMapProgress` type. The extension wraps
 * `vscode.Progress` → `ProgressReporter`; the CLI wraps `ora` spinner or
 * no-op. Messages are plain English; the surface layer handles i18n.
 */
export interface ProgressReporter {
  report(update: string | { message?: string; increment?: number }): void;
}

/** No-op progress for non-interactive / test contexts. */
export const noopProgressReporter: ProgressReporter = { report() {} };

/**
 * Handle returned by `createHeartbeat`. Call `stop()` when the monitored
 * operation completes.
 */
export interface ProgressHeartbeat {
  stop(): void;
}

/**
 * Periodically updates progress with elapsed seconds while a long-running step
 * (e.g. LLM CLI) has no finer-grained events. Plain English only — the
 * extension's locale-aware version lives in `extension/src/progress.ts`.
 */
export function createHeartbeat(
  progress: ProgressReporter | undefined,
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
    progress.report(`${baseMessage} (waiting ${secs} second(s))`);
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
