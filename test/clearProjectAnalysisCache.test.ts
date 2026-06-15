import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { clearProjectAnalysisCache } from "../extension/src/store/clearProjectAnalysisCache";
import {
  buildRecordMeta,
  buildSessionRecord,
  ensureStore,
  readRecord,
  listRecords,
  writeRecord,
} from "../extension/src/store/sessionStore";
import type { SessionOutline } from "../extension/src/llm/types";

const sampleOutline: SessionOutline = {
  title: "Test",
  outline: [{ title: "Topic", details: [{ text: "detail" }] }],
};

function recordFor(projectSlug: string, sessionId: string) {
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      projectPath: `/tmp/${projectSlug}`,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptFreshnessToken: sessionId,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 4 },
      sessionLabel: sessionId,
    }),
    sampleOutline
  );
}

describe("clearProjectAnalysisCache", () => {
  it("removes project session records and leaves other projects intact", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-mindmap-clear-"));
    await ensureStore(storeDir);
    await writeRecord(storeDir, recordFor("proj-a", "s1"));
    await writeRecord(storeDir, recordFor("proj-a", "s2"));
    await writeRecord(storeDir, recordFor("proj-b", "s3"));

    const cleared = await clearProjectAnalysisCache(storeDir, "proj-a");
    expect(cleared.removedSessionRecords).toBe(2);
    expect(await readRecord(storeDir, "proj-a", "s1")).toBeUndefined();
    expect(await readRecord(storeDir, "proj-b", "s3")).toBeDefined();

    const remaining = await listRecords(storeDir);
    expect(remaining.map((r) => r.meta.sessionId)).toEqual(["s3"]);
  });

  it("clears ontology cache files", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-mindmap-clear-"));
    await ensureStore(storeDir);
    await writeRecord(storeDir, recordFor("proj-a", "s1"));
    const ontologyCacheDir = path.join(storeDir, "ontology", "cache");
    await fs.mkdir(ontologyCacheDir, { recursive: true });
    await fs.writeFile(path.join(ontologyCacheDir, "sample.json"), "{}", "utf8");

    await clearProjectAnalysisCache(storeDir, "proj-a");

    const files = await fs.readdir(ontologyCacheDir);
    expect(files.filter((f) => f.endsWith(".json"))).toEqual([]);
  });
});
