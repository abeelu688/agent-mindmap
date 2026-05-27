import { describe, expect, it } from "vitest";
import { resolveConceptPathWithEquivalences } from "../extension/src/llm/resolveConceptPathWithEquivalences";
import type { SegmentEquivalence } from "../extension/src/llm/types";

const artRuntimeEq: SegmentEquivalence[] = [
  {
    canonical: "art",
    aliases: ["runtime", "androidruntime", "android-runtime"],
    scope: {
      pathPrefix: ["android"],
      evidenceKeywords: ["libart", "art", "dex2oat"],
    },
    confidence: 0.9,
  },
];

describe("resolveConceptPathWithEquivalences", () => {
  it("rewrites runtime to art under android when evidence matches", () => {
    expect(
      resolveConceptPathWithEquivalences(
        ["android", "runtime", "androidruntime", "start"],
        artRuntimeEq,
        { title: "AndroidRuntime", items: ["libart.so"] }
      )
    ).toEqual(["android", "art", "start"]);
  });

  it("does not rewrite runtime without android prefix", () => {
    expect(
      resolveConceptPathWithEquivalences(
        ["node", "runtime"],
        artRuntimeEq,
        { title: "Node runtime", items: ["nodejs"] }
      )
    ).toEqual(["node", "runtime"]);
  });

  it("skips equivalence when evidence keywords do not match", () => {
    expect(
      resolveConceptPathWithEquivalences(
        ["android", "runtime", "start"],
        artRuntimeEq,
        { title: "Generic", items: ["unrelated topic"] }
      )
    ).toEqual(["android", "runtime", "start"]);
  });
});
