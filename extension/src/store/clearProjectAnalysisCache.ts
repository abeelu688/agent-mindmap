import { clearProjectAnalysisCache as coreClearProjectAnalysisCache } from "@agent-mindmap/core";
import { getStoreForDir } from "./storeClient";

/**
 * Extension adapter for clearProjectAnalysisCache — pre-resolves the Store
 * instance from getStoreForDir so callers don't need to pass it.
 */
export async function clearProjectAnalysisCache(
  storeDir: string,
  projectSlug: string
): Promise<{ removedSessionRecords: number }> {
  const store = await getStoreForDir(storeDir);
  return coreClearProjectAnalysisCache(storeDir, projectSlug, store);
}
