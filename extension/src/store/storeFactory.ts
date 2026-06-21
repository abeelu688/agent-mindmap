import * as vscode from "vscode";
import { RemoteStore, type Store } from "@agent-mindmap/shared";
import { t } from "../l10n/uiTranslate";

/**
 * Team-mode configuration: server URL lives in `agentMindmap.team.serverUrl`
 * (settings.json — visible, shareable); the API key lives in SecretStorage
 * (per-machine, never written to disk in plaintext).
 *
 * `tryCreateRemoteStore` returns a `RemoteStore` when team mode is enabled
 * (URL set + key present), or `undefined` otherwise. Callers fall back to
 * the local store (`bootstrapStore`).
 *
 * The store is memoized per (serverUrl + keyFingerprint) so a config change
 * requires either a window reload or an explicit `__resetRemoteStoreForTest`
 * — we don't want every `getStore()` call to re-read SecretStorage (async)
 * or re-fetch the project list.
 */

const SECRET_KEY = "agentMindmap.team.apiKey";

let cached: { url: string; keyHash: string; store: RemoteStore } | undefined;

/** Simple FNV-1a hash so we can detect key rotation without keeping the key in memory. */
function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function getTeamServerUrl(): string {
  return vscode.workspace.getConfiguration("agentMindmap").get<string>("team.serverUrl", "").trim();
}

export async function getTeamApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get(SECRET_KEY)) ?? "";
}

/**
 * Returns a `RemoteStore` if team mode is configured (URL + key both
 * present), else `undefined`. Memoized — the cache key is (url, keyFingerprint)
 * so a key rotation picks up on the next call but unchanged config reuses
 * the existing store.
 *
 * Throws if team mode is partially configured (URL set but key missing) —
 * the caller should surface a "configure the team service" prompt.
 */
export async function tryCreateRemoteStore(
  context: vscode.ExtensionContext
): Promise<RemoteStore | undefined> {
  const url = getTeamServerUrl();
  if (!url) {
    cached = undefined;
    return undefined;
  }
  const key = await getTeamApiKey(context);
  if (!key) {
    throw new TeamConfigIncompleteError(
      t(
        "team.config.invalid",
        "Agent Mind Map: Team service URL is set but the API key is missing. Run 'Agent Mind Map: Configure Team Service'.",
        "missing-api-key"
      )
    );
  }
  const kp = fingerprint(key);
  if (cached && cached.url === url && cached.keyHash === kp) {
    return cached.store;
  }
  const store = new RemoteStore(url, key);
  cached = { url, keyHash: kp, store };
  return store;
}

/**
 * Returns the team-mode `Store`, or `undefined` when team mode is off /
 * partially configured (caller falls back to local store). Throws on
 * partial config (URL set, key missing) so the caller can surface the
 * "Configure Team Service" prompt.
 *
 * Type signature keeps the return as `Store` so callers don't need to
 * import `RemoteStore`.
 */
export async function getRemoteStoreIfEnabled(
  context: vscode.ExtensionContext
): Promise<Store | undefined> {
  const remote = await tryCreateRemoteStore(context);
  return remote;
}

export class TeamConfigIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamConfigIncompleteError";
  }
}

/**
 * Write the API key to SecretStorage. Empty string deletes it.
 */
export async function setTeamApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  if (key) {
    await context.secrets.store(SECRET_KEY, key);
  } else {
    await context.secrets.delete(SECRET_KEY);
  }
  // Invalidate the cache so the next read picks up the new key.
  cached = undefined;
}

export function __resetRemoteStoreForTest(): void {
  cached = undefined;
}

export const __testing = { fingerprint, SECRET_KEY };
