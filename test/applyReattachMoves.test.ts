import { describe, expect, it } from "vitest";
import {
  applyReattachMoveToPath,
  applyReattachMovesToRecords,
} from "../extension/src/llm/applyReattachMoves";

function topic(path: string[], title: string) {
  return { title, summary: title, items: [], conceptPath: path };
}

function record(sessionId: string, topics: ReturnType<typeof topic>[]) {
  return {
    schemaVersion: 1,
    meta: {
      sessionId,
      projectSlug: "demo",
      projectPath: "/demo",
      sessionLabel: sessionId,
      transcriptPath: `/demo/${sessionId}.jsonl`,
      hostId: "cursor",
      builtAt: 1,
    },
    graph: { topics },
  } as import("../extension/src/store/storeTypes").SessionRecord;
}

describe("applyReattachMoves", () => {
  it("rewrites orphan root onto nested chain", () => {
    const next = applyReattachMoveToPath(
      ["inner", "runtime"],
      { from: "inner", toPath: ["wrapper", "inner"], confidence: 0.9 }
    );
    expect(next).toEqual(["wrapper", "inner", "runtime"]);
  });

  it("applies LLM moves to session records", () => {
    const records = [
      record("s1", [
        topic(["inner", "module"], "orphan"),
        topic(["wrapper", "inner", "module"], "nested"),
      ]),
    ];
    const moved = applyReattachMovesToRecords(records, [
      { from: "inner", toPath: ["wrapper", "inner"], confidence: 0.9 },
    ]);
    expect(moved[0].graph.topics[0].conceptPath).toEqual([
      "wrapper",
      "inner",
      "module",
    ]);
  });
});
