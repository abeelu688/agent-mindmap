/**
 * Core logger — locale-free, no VS Code dependency.
 *
 * The extension wraps `agentLog` / `mindMapLog`; the CLI wraps `console.log`
 * or `pino`; tests use `noopLogger`.
 */
export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, err?: unknown, data?: Record<string, unknown>): void;
}

/** No-op logger for non-interactive / test contexts. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};
