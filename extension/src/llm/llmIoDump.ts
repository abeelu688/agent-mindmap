/**
 * Re-export LLM IO dump from @agent-mindmap/core plus the extension adapter.
 *
 * The core module accepts a `LlmDumpDeps` parameter; the extension adapter
 * (extensionLlmDumpDeps) provides the VS Code-specific implementation.
 */
export {
  writeLlmIoDump,
  dumpLlmReplay,
  dumpLlmCallResult,
  errorForDump,
  resolveLlmDumpRoots,
  resolveLlmDumpDir,
  logLlmDumpLocationsOnce,
  dumpDirForWorkspace,
  LLM_DUMP_FOLDER,
  type LlmIoDumpPayload,
  type LlmDumpSource,
} from "@agent-mindmap/core";

export { extensionLlmDumpDeps } from "./llmIoDumpAdapter";
