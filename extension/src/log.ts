import * as vscode from "vscode";

// ─── Log level ──────────────────────────────────────────────────────────────

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PREFIX: Record<LogLevel, string> = {
  debug: "🔍",
  info: "ℹ️",
  warn: "⚠️",
  error: "❌",
};

// ─── Channel management ─────────────────────────────────────────────────────

let channel: vscode.OutputChannel | undefined;
let disabled = false;

/**
 * Initialize the log channel. Call once from `activate()`.
 * The channel is automatically disposed via `context.subscriptions`.
 */
export function initLog(context: vscode.ExtensionContext): void {
  try {
    channel = vscode.window.createOutputChannel("Agent Mind Map");
    context.subscriptions.push(channel);
    disabled = false;
  } catch {
    // Running outside VS Code (e.g. vitest) — log to nowhere.
    disabled = true;
  }
}

function ensureChannel(): vscode.OutputChannel | undefined {
  if (disabled) {
    return undefined;
  }
  if (!channel) {
    try {
      channel = vscode.window.createOutputChannel("Agent Mind Map");
    } catch {
      disabled = true;
    }
  }
  return channel;
}

// ─── Internal write ─────────────────────────────────────────────────────────

function write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const ch = ensureChannel();
  if (!ch) {
    // Fallback to console when outside VS Code (tests, scripts).
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
    fn(`[agent-mindmap] ${msg}`, data ?? "");
    return;
  }
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  ch.appendLine(`${LEVEL_PREFIX[level]} [${stamp}] ${msg}`);
  if (data && Object.keys(data).length) {
    ch.appendLine(`  ${JSON.stringify(data)}`);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const agentLog = {
  debug(msg: string, data?: Record<string, unknown>): void {
    write("debug", msg, data);
  },

  info(msg: string, data?: Record<string, unknown>): void {
    write("info", msg, data);
  },

  warn(msg: string, data?: Record<string, unknown>): void {
    write("warn", msg, data);
  },

  error(msg: string, err?: unknown, data?: Record<string, unknown>): void {
    const detail = err instanceof Error ? err.message : err ? String(err) : "";
    const merged = {
      ...data,
      ...(err instanceof Error ? { stack: err.stack, name: err.name } : {}),
    };
    write("error", detail ? `${msg}: ${detail}` : msg, Object.keys(merged).length ? merged : undefined);
  },
};

/**
 * Backward-compatible replacement for `mindMapLog()`.
 * Existing call sites can switch to `agentLog.info()` directly;
 * this function is provided for a smooth migration.
 */
export function mindMapLogCompat(message: string): void {
  agentLog.info(message);
}
