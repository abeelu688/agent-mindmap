/**
 * Core store accessor — decouples from `extension/src/store/storeClient`.
 *
 * The extension delegates to `getStore()` / `getStoreForDir()` singletons;
 * the CLI reads from the shared store dir; tests inject an in-memory store.
 */
import type { Store } from "@agent-mindmap/shared";

export interface StoreAccess {
  /** Get the default Store (extension: primary store dir). */
  getStore(): Promise<Store>;

  /** Get a Store for a specific store directory. */
  getStoreForDir(storeDir: string): Promise<Store>;

  /** Ensure the store directory and schema are initialized. */
  ensureStore(storeDir: string): Promise<void>;

  /** Resolve the primary store directory path. */
  getStoreDir(): string;
}
