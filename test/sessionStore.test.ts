import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRecordMeta,
  buildSessionRecord,
  ensureStore,
  isRecordFresh,
  listRecords,
  rebuildIndex,
  readIndex,
  readRecord,
  recordPath,
  sha256Hex,
  writeRecord,
} from "../extension/src/store/sessionStore";
import type {
  SessionRecord,
  SessionRecordMeta,
} from "../extension/src/store/storeTypes";
import type { SessionOutline } from "../extension/src/llm/types";

const sampleOutline: SessionOutline = {
  title: "Binder",
  outline: [
    {
      title: "Transaction code",
      details: [{ text: "tr.code 才是真正的命令字段" }],
    },
  ],
};

function makeMeta(overrides: Partial<SessionRecordMeta> = {}): SessionRecordMeta {
  return buildRecordMeta({
    sessionId: "11111111-2222-3333-4444-555555555555",
    projectSlug: "home-welde-cursor-airecorder",
    projectPath: "/home/welde/cursor/airecorder",
    transcriptPath: "/tmp/fake/transcript.jsonl",
    transcriptMtimeMs: 1_700_000_000_000,
    transcriptSha256: sha256Hex("hello"),
    llm: { provider: "fake", model: "" },
    promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
    sessionLabel: "1111111… · whenever",
    ...overrides,
  });
}

describe("sessionStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agent-mindmap-store-"));
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("ensureStore creates layout files", async () => {
    await ensureStore(dir);
    const schemaPath = join(dir, "schema.json");
    const record = await readRecord(dir, "x", "y");
    expect(record).toBeUndefined();
    expect(schemaPath).toMatch(/schema\.json$/);
  });

  it("round-trips a session record", async () => {
    const meta = makeMeta();
    const record = buildSessionRecord(meta, sampleOutline);
    await writeRecord(dir, record);
    const loaded = await readRecord(dir, meta.projectSlug, meta.sessionId);
    expect(loaded).toBeDefined();
    expect(loaded!.meta.sessionId).toBe(meta.sessionId);
    expect(loaded!.outline.outline[0].title).toBe("Transaction code");
    expect(recordPath(dir, meta.projectSlug, meta.sessionId)).toContain(
      meta.projectSlug
    );
  });

  it("listRecords returns every saved record across projects", async () => {
    const a = buildSessionRecord(
      makeMeta({
        sessionId: "aaa",
        projectSlug: "proj-a",
      }),
      sampleOutline
    );
    const b = buildSessionRecord(
      makeMeta({
        sessionId: "bbb",
        projectSlug: "proj-b",
      }),
      sampleOutline
    );
    await writeRecord(dir, a);
    await writeRecord(dir, b);

    const all = await listRecords(dir);
    const slugs = all.map((r) => r.meta.projectSlug).sort();
    expect(slugs).toEqual(["proj-a", "proj-b"]);
  });

  it("rebuildIndex writes a compact projection sorted by analyzedAt desc", async () => {
    const older = buildSessionRecord(
      makeMeta({ sessionId: "older", analyzedAt: 100 }),
      sampleOutline
    );
    const newer = buildSessionRecord(
      makeMeta({ sessionId: "newer", analyzedAt: 200 }),
      sampleOutline
    );
    await writeRecord(dir, older);
    await writeRecord(dir, newer);

    const idx = await rebuildIndex(dir);
    expect(idx.entries.map((e) => e.sessionId)).toEqual(["newer", "older"]);

    const reread = await readIndex(dir);
    expect(reread?.entries.length).toBe(2);
    expect(reread?.entries[0].rootTitle).toBe("Binder");
    expect(reread?.entries[0].topicCount).toBe(1);
  });

  it("isRecordFresh detects transcript / param / model / promptVersion changes", () => {
    const meta = makeMeta({ promptVersion: 2 });
    const record: SessionRecord = buildSessionRecord(meta, sampleOutline);

    expect(
      isRecordFresh(record, {
        transcriptSha256: meta.transcriptSha256,
        promptParams: meta.promptParams,
        promptVersion: 2,
        llm: meta.llm,
      })
    ).toBe(true);

    expect(
      isRecordFresh(record, {
        transcriptSha256: "different",
        promptParams: meta.promptParams,
        promptVersion: 2,
        llm: meta.llm,
      })
    ).toBe(false);

    expect(
      isRecordFresh(record, {
        transcriptSha256: meta.transcriptSha256,
        promptParams: { maxTopics: 5, maxItemsPerTopic: 6 },
        promptVersion: 2,
        llm: meta.llm,
      })
    ).toBe(false);

    expect(
      isRecordFresh(record, {
        transcriptSha256: meta.transcriptSha256,
        promptParams: meta.promptParams,
        promptVersion: 2,
        llm: { provider: "fake", model: "claude" },
      })
    ).toBe(false);

    expect(
      isRecordFresh(record, {
        transcriptSha256: meta.transcriptSha256,
        promptParams: meta.promptParams,
        promptVersion: 2,
        llm: { provider: "fake", model: "  " },
      })
    ).toBe(true);

    // Bumped promptVersion → stale
    expect(
      isRecordFresh(record, {
        transcriptSha256: meta.transcriptSha256,
        promptParams: meta.promptParams,
        promptVersion: 3,
        llm: meta.llm,
      })
    ).toBe(false);

    // Records written before versioning (no promptVersion field) are treated
    // as v1 and become stale once the current prompt is bumped to v2+.
    const legacy = buildSessionRecord(
      makeMeta({ promptVersion: undefined }),
      sampleOutline
    );
    expect(
      isRecordFresh(legacy, {
        transcriptSha256: legacy.meta.transcriptSha256,
        promptParams: legacy.meta.promptParams,
        promptVersion: 2,
        llm: legacy.meta.llm,
      })
    ).toBe(false);
  });

  it("readRecord rejects schemaVersion mismatch", async () => {
    const meta = makeMeta();
    const record = buildSessionRecord(meta, sampleOutline);
    await writeRecord(dir, record);
    const file = recordPath(dir, meta.projectSlug, meta.sessionId);
    const { writeFile } = await import("fs/promises");
    await writeFile(
      file,
      JSON.stringify({ ...record, schemaVersion: 999 }),
      "utf8"
    );
    const loaded = await readRecord(dir, meta.projectSlug, meta.sessionId);
    expect(loaded).toBeUndefined();
  });
});
