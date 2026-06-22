/**
 * Port interfaces — seams where core's business logic delegates to the surface
 * layer (VS Code extension, CLI, or test harness).
 *
 * - `ProgressReporter` — progress updates during long-running operations
 * - `MindMapSink` — mind map refresh + informational messages
 * - `ConfigStore` — configuration read/write
 */
export type { ProgressReporter, ProgressHeartbeat } from "./ProgressReporter";
export { noopProgressReporter, createHeartbeat } from "./ProgressReporter";

export type { MindMapSink } from "./MindMapSink";
export { noopMindMapSink } from "./MindMapSink";

export type { ConfigStore } from "./ConfigStore";
