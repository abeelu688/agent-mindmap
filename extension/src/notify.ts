import * as vscode from "vscode";
import { agentLog } from "./log";
import { AgentMindmapError, isCancellationError, isUserFacingError } from "./errors";
import { t } from "./l10n/uiTranslate";

// ─── Notification level ─────────────────────────────────────────────────────

type NotifyLevel = "info" | "warning" | "error";

/**
 * Map error codes to notification levels.
 * Unlisted codes default to the `fallbackLevel` passed to `notify()`.
 */
const CODE_LEVEL: Partial<Record<string, NotifyLevel>> = {
  // LLM — most are warnings (user can retry), not errors
  "llm:cli-missing": "warning",
  "llm:timeout": "warning",
  "llm:bad-json": "warning",
  "llm:bad-shape": "warning",
  "llm:empty": "warning",
  "llm:cancelled": "info",
  // Store
  "store:corrupt-record": "info",
  "store:read-failed": "warning",
  "store:write-failed": "warning",
  // Transcript
  "transcript:empty": "info",
  // Merge
  "merge:failed": "error",
  "merge:ontology-failed": "warning",
  "merge:reattach-failed": "warning",
  // Host
  "host:no-workspace": "warning",
  "host:empty-transcripts": "info",
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Show a VS Code notification for an error, auto-selecting the level
 * based on the error code. Also logs the error via `agentLog`.
 *
 * Cancellation errors are silently ignored.
 */
export function notify(
  err: unknown,
  fallbackLevel: NotifyLevel = "error"
): void {
  if (isCancellationError(err)) {
    return;
  }

  const level = resolveLevel(err, fallbackLevel);
  const message = resolveMessage(err);

  agentLog.error("Notify user", err);

  const fn =
    level === "error"
      ? vscode.window.showErrorMessage
      : level === "warning"
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

  void fn(message);
}

/**
 * Show a simple informational message. Does not log as an error.
 */
export function notifyInfo(message: string): void {
  agentLog.info(message);
  void vscode.window.showInformationMessage(message);
}

/**
 * Show a warning message. Logs as a warning.
 */
export function notifyWarning(message: string): void {
  agentLog.warn(message);
  void vscode.window.showWarningMessage(message);
}

/**
 * Show an error message. Logs as an error.
 */
export function notifyError(message: string, err?: unknown): void {
  agentLog.error(message, err);
  void vscode.window.showErrorMessage(message);
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function resolveLevel(err: unknown, fallback: NotifyLevel): NotifyLevel {
  if (err instanceof AgentMindmapError) {
    return CODE_LEVEL[err.code] ?? fallback;
  }
  return fallback;
}

function resolveMessage(err: unknown): string {
  if (isUserFacingError(err)) {
    return (err as Error).message;
  }
  if (err instanceof Error) {
    return t(
      "notify.unexpected",
      "Agent Mind Map: An unexpected error occurred: {0}",
      err.message
    );
  }
  return t(
    "notify.unexpected",
    "Agent Mind Map: An unexpected error occurred."
  );
}
