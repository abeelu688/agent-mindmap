/**
 * Extension adapter for organizeByTree — pre-binds the extension's
 * LlmDumpDeps so callers don't need to pass it every time.
 */
import {
  organizeByTree as coreOrganizeByTree,
  type OrganizeByTreeOpts,
} from "@agent-mindmap/core";
import { extensionLlmDumpDeps } from "../../llm/llmIoDumpAdapter";
import type { LlmProvider, SessionOutline, ProgressReporter } from "@agent-mindmap/core";

export type { OrganizeByTreeOpts };

export async function organizeByTree(
  opts: OrganizeByTreeOpts,
  provider: LlmProvider,
  signal: AbortSignal,
  progress?: ProgressReporter
): Promise<SessionOutline> {
  return coreOrganizeByTree(opts, provider, signal, progress, extensionLlmDumpDeps);
}
