import {
  bootstrapStore,
  RemoteStore,
  SqliteStore,
  TeamStore,
  type PushQueueLike,
  type Store,
} from "@agent-mindmap/shared";
import { getStoreDir } from "../paths";
import { getRemoteStoreIfEnabled } from "./storeFactory";
import { PushQueue } from "./pushQueue";

/**
 * Process-wide accessor for the extension's `Store`.
 *
 * Team mode (P4.2 + P4.3): when `agentMindmap.team.serverUrl` is set and an
 * API key exists in SecretStorage, `getStore()` returns a `TeamStore` wrapper
 * that:
 *   - Reads from the team service via `RemoteStore` (authoritative for
 *     cross-machine aggregation).
 *   - Writes locally to `SqliteStore` (working copy) + enqueues an async
 *     push to the team service via `PushQueue` (with retry + watermark).
 * When team mode is off (or partially configured), `getStore()` falls back to
 * the per-`storeDir` local `SqliteStore` via `bootstrapStore`.
 */
const cache = new Map<string, Promise<Store>>();
const teamCache = new Map<string, Promise<Store>>();
let remoteStorePromise: Promise<RemoteStore | undefined> | undefined;
const pushQueues: PushQueue[] = [];

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

async function resolveTeamStoreForDir(storeDir: string): Promise<Store> {
  const existing = teamCache.get(storeDir);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const remote = await getRemoteStore();
    if (!remote) {
      // Team mode off — fall through to local.
      return bootstrapForDir(storeDir);
    }
    const local = await bootstrapForDir(storeDir);
    // The push queue needs the local SqliteStore specifically (for kv
    // watermarks). If the local store isn't a SqliteStore (unlikely after
    // P2.4 removed the JsonFs fallback), skip the queue — pushes will go
    // through RemoteStore directly via TeamStore.upsertRecord's no-queue
    // path.
    if (!(local instanceof SqliteStore)) {
      console.warn(
        `[agent-mindmap] team mode: local store is not SqliteStore (${local.constructor.name}); push queue disabled`
      );
      return new TeamStore(local, remote, noopQueue);
    }
    const queue = new PushQueue(local, remote);
    pushQueues.push(queue);
    return new TeamStore(local, remote, queue);
  })();
  teamCache.set(storeDir, promise);
  return promise;
}

async function getRemoteStore(): Promise<RemoteStore | undefined> {
  if (!remoteStorePromise) {
    remoteStorePromise = (async () => {
      try {
        const remote = await getRemoteStoreIfEnabled(getContextForSecrets());
        return remote instanceof RemoteStore ? remote : undefined;
      } catch (err) {
        // Surface and fall back to local store — don't break activation.
        console.warn(`[agent-mindmap] team store disabled: ${(err as Error).message}`);
        return undefined;
      }
    })();
  }
  return remoteStorePromise;
}

// A no-op queue used when the local store can't persist watermarks (e.g.
// non-SqliteStore local). TeamStore.upsertRecord still writes locally; pushes
// just don't happen until the next activation drain.
const noopQueue: PushQueueLike = {
  enqueue: async () => {},
  drain: async () => {},
};

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
  teamCache.clear();
}
function getContextForSecrets(): import("vscode").ExtensionContext {
  if (!extensionContext) {
    throw new Error("storeClient: extension context not set");
  }
  return extensionContext as import("vscode").ExtensionContext;
}

export async function getStore(): Promise<Store> {
  const remote = await getRemoteStore();
  if (remote) {
    return resolveTeamStoreForDir(getStoreDir());
  }
  return bootstrapForDir(getStoreDir());
}

export async function getStoreForDir(storeDir: string): Promise<Store> {
  const remote = await getRemoteStore();
  if (remote) {
    return resolveTeamStoreForDir(storeDir);
  }
  return bootstrapForDir(storeDir);
}

/**
 * Drain all push queues. Called by the "Push Sessions to Team Service"
 * command. Safe to call multiple times — drains dedupe via the queue's
 * in-flight flag.
 */
export async function drainAllPushQueues(): Promise<void> {
  for (const q of pushQueues) {
    await q.drain();
  }
}

/**
 * Returns true when team mode is enabled (URL + key both configured and a
 * `RemoteStore` was successfully constructed).
 */
export async function isTeamModeEnabled(): Promise<boolean> {
  const remote = await getRemoteStore();
  return remote !== undefined;
}

/**
 * Returns the local `SqliteStore` for the active `storeDir`, or `undefined`
 * if the local store isn't a `SqliteStore` (unlikely). Used by the
 * push-to-team command to enumerate records + set pending flags.
 */
export async function getLocalSqliteStore(): Promise<SqliteStore | undefined> {
  const store = await bootstrapForDir(getStoreDir());
  return store instanceof SqliteStore ? store : undefined;
}

/** Dispose all push queues. Called on deactivate. */
export function disposePushQueues(): void {
  for (const q of pushQueues) {
    q.dispose();
  }
}

/** Drop memoized team remote store so config / SecretStorage changes take effect without reload. */
export function resetTeamStoreCache(): void {
  remoteStorePromise = undefined;
  teamCache.clear();
}

/**
 * For tests: drop the memoized stores so the next call rebuilds. Pass a dir to
 * invalidate just one entry, or omit to clear all.
 */
export function __resetStoreForTest(storeDir?: string): void {
  if (storeDir) {
    cache.delete(storeDir);
    teamCache.delete(storeDir);
  } else {
    cache.clear();
    teamCache.clear();
  }
  remoteStorePromise = undefined;
}

/** For tests: inject a fake extension context (with SecretStorage). */
export function __setContextForTest(ctx: unknown): void {
  extensionContext = ctx;
  remoteStorePromise = undefined;
  teamCache.clear();
}
