import { bootstrapStore, type Store } from "@agent-mindmap/shared";
import { getStoreDir } from "../paths";
import { getRemoteStoreIfEnabled } from "./storeFactory";

/**
 * Process-wide accessor for the extension's `Store`.
 *
 * Team mode (P4.2): when `agentMindmap.team.serverUrl` is set and an API key
 * exists in SecretStorage, `getStore()` returns a memoized `RemoteStore` and
 * the local SQLite store is bypassed for read/write paths. When team mode is
 * off or partially configured, `getStore()` falls back to `bootstrapStore`
 * (the per-`storeDir` local SQLite/JSON store).
 *
 * `getStoreForDir(storeDir)` is the variant for callers that captured a
 * `storeDir` at enqueue time (notably `codeRefQueue`) and must process against
 * THAT store, not the current `getStoreDir()` — the user may change
 * `projectsDir` between enqueue and process. Team mode ignores the dir hint
 * (the team service keys on project slug, not local path).
 */
const cache = new Map<string, Promise<Store>>();
let remoteStorePromise: Promise<Store | undefined> | undefined;

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

async function resolveStore(): Promise<Store> {
  if (!remoteStorePromise) {
    remoteStorePromise = (async () => {
      try {
        // `getRemoteStoreIfEnabled` reads `agentMindmap.team.serverUrl` +
        // SecretStorage. Returns undefined when team mode is off. Throws
        // `TeamConfigIncompleteError` when partially configured — we let
        // that propagate so the caller can surface a "configure team
        // service" prompt.
        const remote = await getRemoteStoreIfEnabled(getContextForSecrets());
        return remote;
      } catch (err) {
        // Surface and fall back to local store — don't break activation.
        console.warn(`[agent-mindmap] team store disabled: ${(err as Error).message}`);
        return undefined;
      }
    })();
  }
  const remote = await remoteStorePromise;
  if (remote) {
    return remote;
  }
  return bootstrapForDir(getStoreDir());
}

// The extension context is set on activation via `setExtensionContext`.
// Until then, `getContextForSecrets()` throws — but team mode is only
// reachable via the configureTeamService command, which requires activation
// to have run. Tests stub this via __setContextForTest.
let extensionContext: unknown | undefined;
export function setExtensionContext(ctx: unknown): void {
  extensionContext = ctx;
  // Invalidate the memoized remote-store promise so a config change picks
  // up on the next getStore() call.
  remoteStorePromise = undefined;
}
function getContextForSecrets(): import("vscode").ExtensionContext {
  if (!extensionContext) {
    throw new Error("storeClient: extension context not set");
  }
  return extensionContext as import("vscode").ExtensionContext;
}

export async function getStore(): Promise<Store> {
  return resolveStore();
}

export async function getStoreForDir(storeDir: string): Promise<Store> {
  // Team mode is dir-agnostic — still route through resolveStore().
  const remote = await remoteStorePromise;
  if (remote) {
    return remote;
  }
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
  remoteStorePromise = undefined;
}

/** For tests: inject a fake extension context (with SecretStorage). */
export function __setContextForTest(ctx: unknown): void {
  extensionContext = ctx;
  remoteStorePromise = undefined;
}
