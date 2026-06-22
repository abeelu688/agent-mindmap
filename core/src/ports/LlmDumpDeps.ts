/**
 * Port interface for LLM IO dump operations — decouples from
 * `vscode.workspace.getConfiguration`, `getStoreDir()`, and extension loggers.
 *
 * The extension implements this against VS Code settings + extension logging;
 * the CLI reads from JSON config files + uses console logging.
 */
export interface LlmDumpDeps {
  /** Whether LLM IO dumping is enabled. Extension reads VS Code config. */
  isDumpEnabled(): boolean;
  /** Resolve the directories where dumps are written. */
  resolveDumpRoots(): string[];
  /** Info log for dump messages (replaces `mindMapLog`). */
  logInfo(message: string): void;
  /** Warning log (replaces `agentLog.warn`). */
  logWarn(message: string, data?: Record<string, unknown>): void;
}
