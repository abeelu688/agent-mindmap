import { JsonFsStore, type Store } from "@agent-mindmap/shared";
import { getStoreDir } from "../paths";

/**
 * Process-wide accessor for the extension's `Store`.
 *
 * Memoizes a `JsonFsStore` keyed on the current `getStoreDir()` string, so a
 * `agentMindmap.storeDir` config change picks up a fresh store on the next
 * call. Call sites that used to do `readRecord(getStoreDir(), slug, id)` swap
 * to `getStore().getRecord(slug, id)`.
 *
 * Only the *read* paths route through here (P1.3). Session-record writes stay
 * on the raw `writeRecord` helper: routing them through `Store.upsertRecord`
 * would bump `.mcp-index.json` on every write, which is a behavior change
 * reserved for a follow-up PR alongside the P4.3 push queue.
 *
 * Forward-compatible: when `bootstrapStore()` (P2.3) or `RemoteStore` (P4.2)
 * land, only this function's implementation changes — every call site stays
 * the same.
 */
let cachedStoreDir: string | undefined;
let cachedStore: Store | undefined;

export function getStore(): Store {
  const dir = getStoreDir();
  if (dir !== cachedStoreDir) {
    cachedStoreDir = dir;
    cachedStore = new JsonFsStore(dir);
  }
  return cachedStore;
}

/** For tests: drop the memoized store so the next `getStore()` rebuilds it. */
export function __resetStoreForTest(): void {
  cachedStoreDir = undefined;
  cachedStore = undefined;
}
