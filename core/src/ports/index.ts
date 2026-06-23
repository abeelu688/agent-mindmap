/**
 * Port interfaces — seams where core's business logic delegates to the surface
 * layer (VS Code extension, CLI, or test harness).
 *
 * - `Logger` — structured logging
 * - `Prompter` — user interaction (quick picks, input, messages)
 * - `ProgressReporter` — progress updates during long-running operations
 * - `MindMapSink` — mind map refresh + informational messages
 * - `ConfigStore` — configuration read/write
 * - `StoreAccess` — Store instance access
 * - `HostAccess` — active host / workspace resolution
 * - `LocalizedStringResolver` — i18n string resolution
 * - `LlmDumpDeps` — LLM IO dump configuration
 * - `CodeRefQueueDeps` — code-reference queue operations
 */
export type { Logger } from "./Logger";
export { noopLogger } from "./Logger";

export type { QuickPickItem, Prompter } from "./Prompter";
export { noopPrompter } from "./Prompter";

export type { ProgressReporter, ProgressHeartbeat } from "./ProgressReporter";
export { noopProgressReporter, createHeartbeat, mergeAbortSignals } from "./ProgressReporter";

export type { MindMapSink } from "./MindMapSink";
export { noopMindMapSink } from "./MindMapSink";

export type { ConfigStore } from "./ConfigStore";

export type { StoreAccess } from "./StoreAccess";

export type { HostAccess } from "./HostAccess";

export type { LocalizedStringResolver } from "./LocalizedStringResolver";
export {
  passthroughLocaleResolver,
  setCoreLocaleResolver,
  getCoreLocaleResolver,
} from "./LocalizedStringResolver";

export type { LlmDumpDeps } from "./LlmDumpDeps";

export type { CodeRefQueueDeps } from "./CodeRefQueueDeps";
