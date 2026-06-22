import { describe, expect, it } from "vitest";
import { buildMergedOutlineMindMap } from "@agent-mindmap/core";
import { buildRecordMeta, buildSessionRecord } from "@agent-mindmap/core";
import { sha256Hex } from "@agent-mindmap/core";
import type { MergedOutline } from "@agent-mindmap/core";

const merged: MergedOutline = {
  title: "Cross-session",
  outline: [
    {
      title: "IPC",
      details: [
        {
          text: "Binder point",
          sources: [{ sessionIndex: 0, turnIndex: 1 }],
        },
      ],
    },
  ],
};

const records = [
  buildSessionRecord(
    buildRecordMeta({
      sessionId: "s1",
      projectSlug: "proj",
      transcriptPath: "/tmp/s1.jsonl",
      transcriptMtimeMs: 1,
      transcriptSha256: sha256Hex("s1"),
      llm: { provider: "fake" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      sessionLabel: "S1",
    }),
    {
      outline: [{ title: "x", details: [{ text: "y" }] }],
    }
  ),
];

describe("buildMergedOutlineMindMap", () => {
  it("maps sessionIndex sources to NodeOriginRef", () => {
    const root = buildMergedOutlineMindMap(merged, records);
    const ipc = root.children?.[0];
    const leaf = ipc?.children?.[0];
    expect(leaf?.data.origin?.refs?.[0].sessionId).toBe("s1");
    expect(leaf?.data.origin?.refs?.[0].turnIndex).toBe(1);
  });
});
