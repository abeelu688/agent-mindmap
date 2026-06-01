import { describe, expect, it } from "vitest";
import {
  applyReattachMoveToPath,
  applyReattachMovesToRecords,
  collapseConsecutiveDuplicateSegments,
  normalizeHubAttachMoves,
  resolveChainedReattachMoves,
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

  it("chains toPath when an earlier move retargets a root segment", () => {
    const resolved = resolveChainedReattachMoves([
      { from: "platform-b", toPath: ["platform-a"], confidence: 0.9 },
      { from: "runtime-module", toPath: ["platform-b", "runtime-module"], confidence: 0.88 },
    ]);
    const subMove = resolved.find((m) => m.from === "runtime-module");
    expect(subMove?.toPath).toEqual(["platform-a", "runtime-module"]);
  });

  it("collapses consecutive duplicate segment keys in paths", () => {
    expect(
      collapseConsecutiveDuplicateSegments(["platform-a", "platform-a", "module"])
    ).toEqual(["platform-a", "module"]);
  });

  it("applies chained moves from LLM without duplicate synonym segments in path", () => {
    const records = [
      record("s1", [
        topic(["runtime-module", "jit"], "runtime topic"),
        topic(["platform-b", "build"], "platform b"),
        topic(["platform-a", "api"], "platform a"),
      ]),
    ];
    const moved = applyReattachMovesToRecords(records, [
      { from: "platform-b", toPath: ["platform-a"], confidence: 0.9 },
      { from: "runtime-module", toPath: ["platform-b", "runtime-module"], confidence: 0.88 },
    ]);
    const roots = new Set(
      moved[0].graph.topics.map((t) => t.conceptPath?.[0]).filter(Boolean)
    );
    expect(roots).toEqual(new Set(["platform-a"]));
    expect(moved[0].graph.topics[0].conceptPath).toEqual([
      "platform-a",
      "runtime-module",
      "jit",
    ]);
  });

  it("does not rewrite roots when LLM omitted a synonym move (mechanical apply only)", () => {
    const records = [
      record("s1", [
        topic(["runtime-module", "jit"], "runtime"),
        topic(["platform-b", "build"], "platform b"),
      ]),
    ];
    const moved = applyReattachMovesToRecords(records, [
      {
        from: "runtime-module",
        toPath: ["platform-b", "platform-a", "runtime-module"],
        confidence: 0.88,
      },
    ]);
    expect(moved[0].graph.topics[0].conceptPath?.[0]).toBe("platform-b");
    expect(moved[0].graph.topics[1].conceptPath?.[0]).toBe("platform-b");
  });

  it("promotes thin hub-attached branches to synonym merge", () => {
    const chains = [
      {
        chainIndex: 1,
        from: "android",
        label: "android",
        topicCount: 3,
        sessionIds: [],
        childSegments: ["build"],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "android",
          label: "android",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
      {
        chainIndex: 2,
        from: "aosp",
        label: "aosp",
        topicCount: 1,
        sessionIds: [],
        childSegments: [],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "aosp",
          label: "aosp",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
      {
        chainIndex: 3,
        from: "artruntime",
        label: "art-runtime",
        topicCount: 6,
        sessionIds: [],
        childSegments: ["oat", "jit", "gc"],
        pathSamples: [],
        keywords: [],
        subtree: {
          segment: "artruntime",
          label: "art-runtime",
          topicCount: 0,
          childSegments: [],
          children: [],
        },
      },
    ];
    const normalized = normalizeHubAttachMoves(
      [
        { from: "aosp", toPath: ["android", "aosp"], confidence: 0.9 },
        { from: "artruntime", toPath: ["android", "artruntime"], confidence: 0.9 },
      ],
      chains
    );
    const aosp = normalized.find((m) => m.from === "aosp");
    const art = normalized.find((m) => m.from === "artruntime");
    expect(aosp?.toPath).toEqual(["android"]);
    expect(art?.toPath).toEqual(["android", "artruntime"]);
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
