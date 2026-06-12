import { notify } from "../notify";
import { isCancellationError } from "../errors";

/**
 * Wrap a command handler with unified error handling.
 * - Cancellation errors are silently ignored.
 * - All other errors are shown to the user via `notify()`.
 *
 * Usage:
 * ```ts
 * vscode.commands.registerCommand("agent-mindmap.openLatest", wrapCommand(commandOpenLatest));
 * ```
 */
export function wrapCommand(
  fn: (...args: unknown[]) => Promise<void>
): (...args: unknown[]) => Promise<void> {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      if (isCancellationError(err)) {
        return;
      }
      notify(err);
    }
  };
}
