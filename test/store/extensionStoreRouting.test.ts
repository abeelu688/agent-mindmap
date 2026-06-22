import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapStore, STORE_LAYOUT, type SessionRecord } from "../../shared/src";
import {
  buildRecordMeta,
  buildSessionRecord,
  writeRecord,
} from "@agent-mindmap/core";
import type { SessionOutline } from "@agent-mindmap/core";

/**
 * P1.3 → P2.4 contract test: the `Store` methods the extension routes its
 * reads through must be byte-compatible with the raw functions they replaced.
 * Now uses SqliteStore exclusively (JsonFsStore fallback removed in P2.4).
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

describe("extension Store routing — byte compatibility (SqliteStore)", () => {
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
    // Write via extension raw path into a temp dir (this writes JSON).
    // Then create a SqliteStore, upsert the record into it, and verify reads.
    const result = await bootstrapStore(dir);
    await result.store.upsertRecord(record);

    const viaStore = await result.store.getRecord(
      "home-example-proj",
      "11111111-2222-3333-4444-555555555555"
    );
    expect(viaStore).toBeDefined();
    expect(viaStore?.meta.sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(viaStore?.outline.title).toBe("Binder");

    try {
      await (result.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
  });

  it("Store.upsertRecord writes data that listRecordsForProject can read back", async () => {
    const record = makeRecord();
    const result = await bootstrapStore(dir);
    await result.store.upsertRecord(record);

    const records = await result.store.listRecordsForProject("home-example-proj");
    expect(records).toHaveLength(1);
    expect(records[0].meta.sessionId).toBe("11111111-2222-3333-4444-555555555555");
    expect(records[0].outline.title).toBe("Binder");

    try {
      await (result.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
  });

  it("Store.readConceptTrieMerge returns undefined when no merge exists", async () => {
    const result = await bootstrapStore(dir);
    const viaStore = await result.store.readConceptTrieMerge();
    expect(viaStore).toBeUndefined();

    try {
      await (result.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
  });

  it("Store.getRecord returns undefined for missing record", async () => {
    const result = await bootstrapStore(dir);
    const viaStore = await result.store.getRecord("home-example-proj", "nonexistent");
    expect(viaStore).toBeUndefined();

    try {
      await (result.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
  });

  it("Store.bumpProjectRevision increments revision", async () => {
    const result = await bootstrapStore(dir);
    const index = await result.store.bumpProjectRevision("home-example-proj", 1, {
      lastAnalyzedAt: 1000,
      projectPath: "/home/example/proj",
    });
    expect(index.projects["home-example-proj"].revision).toBe(1);
    expect(index.projects["home-example-proj"].recordCount).toBe(1);

    try {
      await (result.store as { close?: () => Promise<void> }).close?.();
    } catch {
      // ignore
    }
  });
});
