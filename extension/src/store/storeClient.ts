import { bootstrapStore, type Store } from "@agent-mindmap/shared";
import { getStoreDir } from "../paths";

/**
 * Process-wide accessor for the extension's `Store`.
 *
 * `getStore()` bootstraps the store for the current `getStoreDir()` (creating +
 * migrating `store.db` on first launch, falling back to `JsonFsStore` if the DB
 * is corrupt) and memoizes the result keyed on the dir string. A
 * `agentMindmap.projectsDir` config change picks up a fresh store on the next
 * call. All session/merge/ontology read AND write paths route through here.
 *
 * `getStoreForDir(storeDir)` is the variant for callers that captured a
 * `storeDir` at enqueue time (notably `codeRefQueue`) and must process against
 * THAT store, not the current `getStoreDir()` — the user may change
 * `projectsDir` between enqueue and process.
 *
 * Forward-compatible: when `RemoteStore` (P4.2) lands, only these functions'
 * implementation changes — every call site stays the same.
 */
const cache = new Map<string, Promise<Store>>();

async function bootstrapForDir(storeDir: string): Promise<Store> {
  const existing = cache.get(storeDir);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const result = await bootstrapStore(storeDir);
    if (result.warning) {
      // Surface to the extension log; the fallback store is still functional.

      console.warn(`[agent-mindmap] store bootstrap: ${result.warning}`);
    }
    return result.store;
  })();
  cache.set(storeDir, promise);
  return promise;
}

export async function getStore(): Promise<Store> {
  return bootstrapForDir(getStoreDir());
}

export async function getStoreForDir(storeDir: string): Promise<Store> {
  return bootstrapForDir(storeDir);
}

/**
 * For tests: drop the memoized stores so the next call rebuilds. Pass a dir to
 * invalidate just one entry, or omit to clear all.
 */
export function __resetStoreForTest(storeDir?: string): void {
  if (storeDir) {
    cache.delete(storeDir);
  } else {
    cache.clear();
  }
}
