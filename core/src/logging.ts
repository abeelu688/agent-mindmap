/**
 * core/logging — VS Code-free logger with a pluggable backend.
 *
 * Defaults to `console.*` so the core package is usable outside the
 * extension. The extension (and eventually the CLI) calls
 * `setCoreLogger()` with its own logging backend.
 */

export interface CoreLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, data?: Record<string, unknown>): void;
}

let instance: CoreLogger = {
  debug: () => {
    /* no-op by default */
  },
  info: (msg) => console.info("[core]", msg),
  warn: (msg) => console.warn("[core]", msg),
  error: (msg, err) =>
    console.error("[core]", msg, err instanceof Error ? err.message : (err ?? "")),
};

export function setCoreLogger(l: CoreLogger): void {
  instance = l;
}

export function getCoreLogger(): CoreLogger {
  return instance;
}
