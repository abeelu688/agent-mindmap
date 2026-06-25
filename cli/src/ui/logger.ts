/**
 * CLI logger — colored output, spinner, TTY auto-detect.
 *
 * Global flags `--quiet`, `--no-progress`, `--no-color`, `--verbose` are
 * honored through a single `applyGlobalFlags()` call at program start.
 */
import pc from "picocolors";
import ora, { type Ora } from "ora";

export type GlobalFlags = {
  quiet: boolean;
  noProgress: boolean;
  noColor: boolean;
  verbose: boolean;
  json: boolean;
};

let flags: GlobalFlags = {
  quiet: false,
  noProgress: false,
  noColor: false,
  verbose: false,
  json: false,
};

/** Apply resolved global flags — call once before any output. */
export function applyGlobalFlags(f: GlobalFlags): void {
  flags = f;
  if (flags.noColor) {
    // picocolors auto-disables when NO_COLOR is set
    process.env.NO_COLOR = "1";
  }
}

/** Check if color output is enabled. */
export function useColor(): boolean {
  return !flags.noColor && pc.isColorSupported;
}

/** Check if progress spinners should be shown. */
export function useProgress(): boolean {
  return !flags.noProgress && process.stdout.isTTY === true;
}

/** Check if quiet mode is enabled. */
export function isQuiet(): boolean {
  return flags.quiet;
}

/** Check if verbose mode is enabled. */
export function isVerbose(): boolean {
  return flags.verbose;
}

// ────────────────────────────────────────────────────────────────────────────
// Logging
// ────────────────────────────────────────────────────────────────────────────

export function log(msg: string): void {
  if (!flags.quiet) {
    process.stdout.write(msg + "\n");
  }
}

export function logError(msg: string): void {
  process.stderr.write(pc.red(`✗ ${msg}`) + "\n");
}

export function logSuccess(msg: string): void {
  if (!flags.quiet) {
    process.stdout.write(pc.green(`✓ ${msg}`) + "\n");
  }
}

export function logInfo(msg: string): void {
  if (!flags.quiet) {
    process.stdout.write(pc.blue(`ℹ ${msg}`) + "\n");
  }
}

export function logWarn(msg: string): void {
  if (!flags.quiet) {
    process.stdout.write(pc.yellow(`⚠ ${msg}`) + "\n");
  }
}

export function logDebug(msg: string): void {
  if (flags.verbose && !flags.quiet) {
    process.stdout.write(pc.dim(`  [debug] ${msg}`) + "\n");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Spinner
// ────────────────────────────────────────────────────────────────────────────

/** Create an ora spinner (or a no-op when `--no-progress` or non-TTY). */
export function createSpinner(text: string): Ora {
  if (!useProgress()) {
    // Return a no-op spinner that still has the Ora interface
    return ora({ text, isSilent: true });
  }
  return ora(text);
}

// ────────────────────────────────────────────────────────────────────────────
// JSON output helper
// ────────────────────────────────────────────────────────────────────────────

let jsonMode = false;

/** Enable JSON output mode (set by --json flag). */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/** Check if JSON output mode is enabled. */
export function isJsonMode(): boolean {
  return jsonMode;
}

/** Print a value as JSON (respects --json flag). */
export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Core Logger adapter
// ────────────────────────────────────────────────────────────────────────────

import type { Logger } from "@agent-mindmap/core";

/** Build a core Logger backed by CLI output. */
export function buildCliLogger(): Logger {
  return {
    info(message: string, data?: Record<string, unknown>) {
      logInfo(message);
      if (data && isVerbose()) {
        logDebug(JSON.stringify(data));
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      logWarn(message);
      if (data) {
        // Always show LLM error details (code + cliCapture) even without --verbose
        if (data.code || data.cliCapture) {
          if (data.code) {
            logDebug(`  code: ${data.code}`);
          }
          if (data.cliCapture && typeof data.cliCapture === "object") {
            const cap = data.cliCapture as { stdout?: string; stderr?: string };
            if (cap.stderr) {
              logDebug(`  stderr: ${cap.stderr.slice(0, 500)}`);
            }
            if (cap.stdout) {
              logDebug(`  stdout (first 500 chars): ${cap.stdout.slice(0, 500)}`);
            }
          }
        }
        if (isVerbose()) {
          logDebug(JSON.stringify(data));
        }
      }
    },
    error(message: string, err?: unknown, data?: Record<string, unknown>) {
      logError(message);
      if (err && isVerbose()) {
        logDebug(String(err));
      }
      if (data && isVerbose()) {
        logDebug(JSON.stringify(data));
      }
    },
  };
}
