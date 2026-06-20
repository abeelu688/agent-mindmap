import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFsStore, STORE_LAYOUT, type SessionRecord } from "../../shared/src";
import {
  buildRecordMeta,
  buildSessionRecord,
  conceptTrieMergePath,
  readRecord,
  writeMergeRecord,
  writeRecord,
} from "../../extension/src/store/sessionStore";
import type { MergeRecord } from "../../extension/src/store/storeTypes";
import type { SessionOutline } from "../../extension/src/llm/types";

/**
 * P1.3 contract test: the `Store` methods the extension now routes its reads
 * through must be byte-compatible with the raw functions they replaced, and the
 * read path must NOT mutate `.mcp-index.json` (only `bumpProjectRevision` /
 * `upsertRecord` do — the latter is intentionally NOT used by the extension
 * write path in P1.3).
 */

const sampleOutline: SessionOutline = {
  title: "Binder",
  outline: [
    {
      title: "Transaction code",
      details: [{ text: "tr.code is the real command field" }],
    },
  ],
};

function makeRecord(overrides: Partial<SessionRecord["meta"]> = {}): SessionRecord {
  const meta = buildRecordMeta({
    sessionId: "11111111-2222-3333-4444-555555555555",
    projectSlug: "home-example-proj",
    projectPath: "/home/example/proj",
    transcriptPath: "/tmp/fake/transcript.jsonl",
    transcriptMtimeMs: 1_700_000_000_000,
    transcriptFreshnessToken: "abc",
    llm: { provider: "fake", model: "" },
    promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
    sessionLabel: "session label",
    ...overrides,
  });
  return buildSessionRecord(meta, sampleOutline);
}

function makeMerge(): MergeRecord {
  return {
    schemaVersion: 1,
    meta: {
      kind: "deterministic",
      builtAt: 12345,
      sessionIds: ["11111111-2222-3333-4444-555555555555"],
      projectSlugs: ["home-example-proj"],
    },
    mindMap: { data: { text: "Root" } },
  };
}

describe("extension Store routing — byte compatibility", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ext-store-routing-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("Store.getRecord reads back what raw writeRecord wrote (read-routing parity)", async () => {
    const record = makeRecord();
    await writeRecord(dir, record);

    const viaStore = await new JsonFsStore(dir).getRecord(
      "home-example-proj",
      "11111111-2222-3333-4444-555555555555"
    );
    const viaRaw = await readRecord(
      dir,
      "home-example-proj",
      "11111111-2222-3333-4444-555555555555"
    );

    expect(viaStore).toBeDefined();
    expect(viaRaw).toBeDefined();
    expect(viaStore).toEqual(viaRaw);
  });

  it("Store.upsertRecord writes a file raw readRecord can read back (write byte-compat)", async () => {
    const record = makeRecord();
    await new JsonFsStore(dir).upsertRecord(record);

    const viaRaw = await readRecord(
      dir,
      "home-example-proj",
      "11111111-2222-3333-4444-555555555555"
    );
    expect(viaRaw).toBeDefined();
    expect(viaRaw?.meta.sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(viaRaw?.outline.title).toBe("Binder");
  });

  it("Store.readConceptTrieMerge reads back what raw writeMergeRecord wrote", async () => {
    const merge = makeMerge();
    await writeMergeRecord(conceptTrieMergePath(dir), merge);

    const viaStore = await new JsonFsStore(dir).readConceptTrieMerge();
    expect(viaStore).toBeDefined();
    expect(viaStore?.schemaVersion).toBe(1);
    expect(viaStore?.mindMap.data.text).toBe("Root");
  });

  it("Store.getRecord does NOT create or modify .mcp-index.json (reads don't bump)", async () => {
    const record = makeRecord();
    await writeRecord(dir, record);

    const mcpIndex = join(dir, STORE_LAYOUT.mcpIndexFile);
    expect(existsSync(mcpIndex)).toBe(false);

    await new JsonFsStore(dir).getRecord(
      "home-example-proj",
      "11111111-2222-3333-4444-555555555555"
    );

    expect(existsSync(mcpIndex)).toBe(false);
  });

  it("Store.bumpProjectRevision DOES update .mcp-index.json (bump path unchanged)", async () => {
    const record = makeRecord();
    await writeRecord(dir, record);

    const mcpIndex = join(dir, STORE_LAYOUT.mcpIndexFile);
    expect(existsSync(mcpIndex)).toBe(false);

    await new JsonFsStore(dir).bumpProjectRevision("home-example-proj", 1, {
      lastAnalyzedAt: 1000,
      projectPath: "/home/example/proj",
    });

    expect(existsSync(mcpIndex)).toBe(true);
    const parsed = JSON.parse(readFileSync(mcpIndex, "utf8")) as {
      projects: Record<string, { revision: number; recordCount: number }>;
    };
    expect(parsed.projects["home-example-proj"].revision).toBe(1);
    expect(parsed.projects["home-example-proj"].recordCount).toBe(1);
  });
});
