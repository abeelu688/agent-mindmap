import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  tryCreateRemoteStore,
  setTeamApiKey,
  getTeamServerUrl,
  getTeamApiKey,
  TeamConfigIncompleteError,
  __resetRemoteStoreForTest,
  __testing,
} from "../../extension/src/store/storeFactory";

// `vscode` resolves to the stub in test/vscode-stub.cjs (via esbuild alias
// in extension/package.json). We cast to any to inject secrets + config.
const vscodeAny = vscode as unknown as {
  workspace: {
    getConfiguration: (scope: string) => {
      get: (key: string, def: unknown) => unknown;
      update?: (key: string, value: unknown, target: unknown) => Promise<void>;
    };
  };
};

type FakeSecrets = {
  store: Map<string, string>;
  get(key: string): Promise<string | undefined>;
  store_(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

function makeFakeContext(): vscode.ExtensionContext & { secrets: FakeSecrets } {
  const secretsMap = new Map<string, string>();
  const secrets: FakeSecrets = {
    store: secretsMap,
    get: async (k) => secretsMap.get(k),
    store_: async (k, v) => {
      secretsMap.set(k, v);
    },
    delete: async (k) => {
      secretsMap.delete(k);
    },
  };
  // VS Code's SecretStorage method is named `store`, but `store_` above is
  // used to avoid clashing with the Map field. Map it back here.
  return {
    secrets: { ...secrets, store: secrets.store_ },
  } as unknown as vscode.ExtensionContext & { secrets: FakeSecrets };
}

describe("storeFactory — getTeamServerUrl", () => {
  const original = vscodeAny.workspace.getConfiguration;
  beforeEach(() => {
    __resetRemoteStoreForTest();
  });
  afterEach(() => {
    vscodeAny.workspace.getConfiguration = original;
  });

  it("returns the trimmed serverUrl setting", () => {
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? "  https://team.example.com  " : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    expect(getTeamServerUrl()).toBe("https://team.example.com");
  });

  it("returns empty string when setting is absent (default)", () => {
    vscodeAny.workspace.getConfiguration = (() => ({
      get: (_key: string, def: unknown) => def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    expect(getTeamServerUrl()).toBe("");
  });
});

describe("storeFactory — tryCreateRemoteStore", () => {
  const original = vscodeAny.workspace.getConfiguration;
  let ctx: vscode.ExtensionContext & { secrets: FakeSecrets };

  beforeEach(() => {
    __resetRemoteStoreForTest();
    ctx = makeFakeContext();
  });
  afterEach(() => {
    vscodeAny.workspace.getConfiguration = original;
  });

  it("returns undefined when serverUrl is empty (team mode off)", async () => {
    vscodeAny.workspace.getConfiguration = (() => ({
      get: (_key: string, def: unknown) => def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    const store = await tryCreateRemoteStore(ctx);
    expect(store).toBeUndefined();
  });

  it("throws TeamConfigIncompleteError when URL is set but key is missing", async () => {
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? "https://team.example.com" : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    await expect(tryCreateRemoteStore(ctx)).rejects.toBeInstanceOf(TeamConfigIncompleteError);
  });

  it("returns a RemoteStore when URL + key are both set", async () => {
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? "https://team.example.com" : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    await setTeamApiKey(ctx, "secret-key");
    const store = await tryCreateRemoteStore(ctx);
    expect(store).toBeDefined();
    expect(store?.constructor.name).toBe("RemoteStore");
  });

  it("memoizes: same URL + key returns the same instance", async () => {
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? "https://team.example.com" : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    await setTeamApiKey(ctx, "secret-key");
    const a = await tryCreateRemoteStore(ctx);
    const b = await tryCreateRemoteStore(ctx);
    expect(a).toBe(b);
  });

  it("cache invalidates on key rotation", async () => {
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? "https://team.example.com" : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    await setTeamApiKey(ctx, "key-1");
    const a = await tryCreateRemoteStore(ctx);
    await setTeamApiKey(ctx, "key-2");
    const b = await tryCreateRemoteStore(ctx);
    expect(a).not.toBe(b);
  });

  it("cache invalidates on URL change", async () => {
    let urlValue = "https://team1.example.com";
    vscodeAny.workspace.getConfiguration = ((scope: string) => ({
      get: (key: string, def: unknown) =>
        scope === "agentMindmap" && key === "team.serverUrl" ? urlValue : def,
    })) as unknown as typeof vscodeAny.workspace.getConfiguration;
    await setTeamApiKey(ctx, "k");
    const a = await tryCreateRemoteStore(ctx);
    urlValue = "https://team2.example.com";
    const b = await tryCreateRemoteStore(ctx);
    expect(a).not.toBe(b);
  });
});

describe("storeFactory — setTeamApiKey", () => {
  let ctx: vscode.ExtensionContext & { secrets: FakeSecrets };

  beforeEach(() => {
    ctx = makeFakeContext();
  });

  it("stores the key in SecretStorage", async () => {
    await setTeamApiKey(ctx, "my-key");
    expect(await getTeamApiKey(ctx)).toBe("my-key");
  });

  it("deletes the key when given empty string", async () => {
    await setTeamApiKey(ctx, "my-key");
    await setTeamApiKey(ctx, "");
    expect(await getTeamApiKey(ctx)).toBe("");
  });
});

describe("storeFactory — fingerprint", () => {
  it("produces a stable hex string for the same input", () => {
    const a = __testing.fingerprint("hello");
    const b = __testing.fingerprint("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });

  it("produces different fingerprints for different inputs", () => {
    expect(__testing.fingerprint("a")).not.toBe(__testing.fingerprint("b"));
  });

  it("the SECRET_KEY constant is the expected value", () => {
    expect(__testing.SECRET_KEY).toBe("agentMindmap.team.apiKey");
  });
});
