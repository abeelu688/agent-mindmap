import { describe, expect, it } from "vitest";
import {
  buildMergeSessionAnalysisInput,
} from "../extension/src/llm/mergeSessionAnalysisInput";
import {
  buildMergeSessionAnalysisTabularInput,
  __testing,
} from "../extension/src/llm/mergeSessionAnalysisTabular";
import { escapeTabularCell } from "../extension/src/llm/promptReattachTabular";
import {
  buildRecordMeta,
  buildSessionRecord,
  sha256Hex,
} from "../extension/src/store/sessionStore";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import type { OutlineNode, SessionOutline } from "../extension/src/llm/types";

function recordWithOutline(sessionId: string, tree: OutlineNode[]) {
  const outline: SessionOutline = { title: "t", outline: tree.length ? tree : [{ title: "t", summary: "s", details: [{ text: "d" }] }] };
  return buildSessionRecord(
    buildRecordMeta({
      sessionId,
      projectSlug: "p",
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
        domains: ["d"],
        nodes: [
          { key: "a", label: "A", parentKeys: [], evidence: ["e"] },
        ],
        segmentEquivalences: [
          {
            canonical: "android",
            aliases: ["androidplatform"],
            scope: { pathPrefix: [] },
          },
        ],
      },
    }
  );
}

describe("mergeSessionAnalysisTabular", () => {
  it("quotes cells with TAB or pipe in evidence", () => {
    expect(escapeTabularCell("a|b")).toBe('"a|b"');
  });

  it("flattens nested outline with parentRow links", () => {
    const rec = recordWithOutline("s1", [
      {
        title: "Top",
        summary: "top",
        children: [
          {
            title: "Leaf",
            summary: "leaf",
            conceptPath: ["a", "b"],
          },
        ],
      },
    ]);
    const input = buildMergeSessionAnalysisInput([rec], "full");
    const rows = __testing.outlineRows(input.sessions);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.[3]).toBe("0");
    expect(rows[1]?.[2]).toBe("0");
    expect(rows[1]?.[6]).toContain("a/b");
  });

  it("includes segmentEquivalences table when present", () => {
    const rec = recordWithOutline("s1", []);
    const input = buildMergeSessionAnalysisInput([rec], "full");
    const body = buildMergeSessionAnalysisTabularInput(input);
    expect(body).toContain("### segmentEquivalences");
    expect(body).toContain("android");
  });
});
