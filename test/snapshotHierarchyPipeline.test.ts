import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLeafSnapshotMerge } from "../extension/src/pipeline/snapshotHierarchy";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "@agent-mindmap/core";
import {
  readSnapshotById,
  readSnapshotManifest,
} from "@agent-mindmap/core";
import { __resetStoreForTest } from "../extension/src/store/storeClient";
import type { LlmProvider, SessionAnalysis, SessionOutline } from "@agent-mindmap/core";
import type { SessionRecord } from "../extension/src/store/storeTypes";

const projectSlug = "proj-a";

const mergeOutline: SessionOutline = {
  title: "Merged",
  outline: [
    {
      title: "Topic",
      children: [
        {
          title: "Detail",
          summary: "summary",
          conceptPath: ["platform", "root"],
          details: [{ text: "detail", sourceTurnIndices: [0] }],
        },
      ],
    },
  ],
};

const validMergeAnalysis: SessionAnalysis = {
  domains: ["platform"],
  nodes: [
    {
      key: "root",
      label: "Root",
      parentKeys: [],
      evidence: ["evidence line one", "evidence line two"],
    },
  ],
  segmentEquivalences: [],
  outline: mergeOutline,
};

function analyzedSessionRecord(sessionId: string, conceptPath: string[]): SessionRecord {
  const outline = topicGraphToOutline({
    topics: [{ title: "topic", conceptPath, items: [{ text: "x" }] }],
    title: sessionId,
  });
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex(sessionId),
      analyzedAt: 1,
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 5,
      sessionLabel: sessionId,
    }),
    outline,
    {
      sessionAnalysis: {
        domains: ["platform"],
        nodes: [
          {
            key: conceptPath[0] ?? "root",
            label: conceptPath[0] ?? "root",
            parentKeys: [],
            evidence: ["evidence line one", "evidence line two"],
          },
        ],
        segmentEquivalences: [],
        outline: { title: sessionId, outline: outline.outline },
      },
    }
  );
}

function leafMergeOpts(
  storeDir: string,
  batchRecords: SessionRecord[],
  provider: LlmProvider,
  batchNo = 1
) {
  return {
    storeDir,
    projectSlug,
    allRecords: batchRecords,
    batchRecords,
    batchNo,
    provider,
    providerId: provider.id,
    hostId: "cursor" as const,
    signal: new AbortController().signal,
  };
}

describe("snapshotHierarchy pipeline", () => {
  let storeDir: string;

  beforeEach(async () => {
    __resetStoreForTest();
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "am-snap-pipe-"));
  });

  afterEach(async () => {
    __resetStoreForTest();
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it("skips M-merge LLM for a single-session L1 batch", async () => {
    let summarizeCalls = 0;
    const provider: LlmProvider = {
      id: "fake",
      async summarize() {
        summarizeCalls += 1;
        throw new Error("LLM should not run for single-session L1 leaf merge");
      },
    };

    const batch = [analyzedSessionRecord("session-a", ["platform", "a"])];
    const { leafId, snapshot } = await runLeafSnapshotMerge(leafMergeOpts(storeDir, batch, provider));

    expect(summarizeCalls).toBe(0);
    expect(leafId).toBe("l1-0001");
    expect(snapshot.meta.sessionIds).toEqual(["session-a"]);
    expect(snapshot.meta.level).toBe(1);

    const manifest = await readSnapshotManifest(storeDir, projectSlug);
    expect(manifest?.sessionToLeafId["session-a"]).toBe("l1-0001");
    expect(manifest?.topLevelIds).toContain("l1-0001");

    const node = manifest?.nodes.find((n) => n.id === leafId);
    expect(node).toBeDefined();
    const reread = node ? await readSnapshotById(storeDir, projectSlug, node) : undefined;
    expect(reread?.meta.sessionIds).toEqual(["session-a"]);
  });

  it("runs M-merge LLM for multi-session L1 batch and persists snapshot + manifest", async () => {
    const schemas: string[] = [];
    const provider: LlmProvider = {
      id: "fake",
      async summarize(input) {
        schemas.push(input.responseSchema ?? "");
        if (input.responseSchema === "session-analysis") {
          return validMergeAnalysis;
        }
        throw new Error(`unexpected schema ${input.responseSchema}`);
      },
    };

    const batch = [
      analyzedSessionRecord("session-a", ["platform", "a"]),
      analyzedSessionRecord("session-b", ["platform", "b"]),
    ];
    const { leafId, snapshot } = await runLeafSnapshotMerge(leafMergeOpts(storeDir, batch, provider));

    expect(schemas).toEqual(["session-analysis"]);
    expect(leafId).toBe("l1-0001");
    expect(snapshot.meta.sessionIds.sort()).toEqual(["session-a", "session-b"]);

    const manifest = await readSnapshotManifest(storeDir, projectSlug);
    expect(manifest?.sessionToLeafId["session-a"]).toBe("l1-0001");
    expect(manifest?.sessionToLeafId["session-b"]).toBe("l1-0001");
  });

  it("throws when M-merge returns invalid session-analysis JSON (fail loud)", async () => {
    const provider: LlmProvider = {
      id: "fake",
      async summarize(input) {
        if (input.responseSchema === "session-analysis") {
          return { domains: [], nodes: [] };
        }
        throw new Error(`unexpected schema ${input.responseSchema}`);
      },
    };

    const batch = [
      analyzedSessionRecord("session-a", ["platform", "a"]),
      analyzedSessionRecord("session-b", ["platform", "b"]),
    ];

    await expect(
      runLeafSnapshotMerge(leafMergeOpts(storeDir, batch, provider))
    ).rejects.toThrow();
  });
});
