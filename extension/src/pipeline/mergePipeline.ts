/**
 * Extension adapter for mergePipeline — resolves Store via getStoreForDir,
 * injects sanitizeSessionRecord and extensionLlmDumpDeps.
 */
import {
  runMergePipeline as coreRunMergePipeline,
  computeBatchMergeCacheKey,
  mindMapTopLevelCount,
  type MergePipelineOpts,
  type MergePipelineResult,
  type MergeRefineMode,
} from "@agent-mindmap/core";
import { getStoreForDir } from "../store/storeClient";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import { extensionLlmDumpDeps } from "../llm/llmIoDumpAdapter";
import type { LlmProvider } from "@agent-mindmap/core";
import type { MindMapProgress } from "../progress";

export type { MergePipelineOpts, MergePipelineResult, MergeRefineMode };
export { computeBatchMergeCacheKey, mindMapTopLevelCount };

export async function runMergePipeline(
  opts: Omit<MergePipelineOpts, "store" | "sanitizeRecord" | "dumpDeps"> & { storeDir: string },
  provider: LlmProvider,
  progress?: MindMapProgress
): Promise<MergePipelineResult> {
  const store = await getStoreForDir(opts.storeDir);
  return coreRunMergePipeline(
    {
      ...opts,
      store,
      sanitizeRecord: sanitizeSessionRecord,
      dumpDeps: extensionLlmDumpDeps,
    },
    provider,
    progress
  );
}
