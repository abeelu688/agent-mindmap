import { describe, expect, it } from "vitest";
import { resolveConceptPathWithEquivalences } from "@agent-mindmap/core";
import type { SegmentEquivalence } from "@agent-mindmap/core";

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
      resolveConceptPathWithEquivalences(["node", "runtime"], artRuntimeEq, {
        title: "Node runtime",
        items: ["nodejs"],
      })
    ).toEqual(["node", "runtime"]);
  });

  it("skips equivalence when evidence keywords do not match", () => {
    expect(
      resolveConceptPathWithEquivalences(["android", "runtime", "start"], artRuntimeEq, {
        title: "Generic",
        items: ["unrelated topic"],
      })
    ).toEqual(["android", "runtime", "start"]);
  });

  it("applies runtime→art only under android/art upstream prefix", () => {
    const underArt: SegmentEquivalence[] = [
      {
        canonical: "art",
        aliases: ["runtime"],
        scope: { pathPrefix: ["android", "art"] },
        confidence: 0.9,
      },
    ];
    expect(
      resolveConceptPathWithEquivalences(["android", "art", "runtime", "start"], underArt, {
        title: "ART",
        items: ["libart"],
      })
    ).toEqual(["android", "art", "start"]);
    expect(
      resolveConceptPathWithEquivalences(["android", "runtime", "start"], underArt, {
        title: "ART",
        items: ["libart"],
      })
    ).toEqual(["android", "runtime", "start"]);
  });

  it("respects downstreamPrefix scope", () => {
    const eq: SegmentEquivalence[] = [
      {
        canonical: "art",
        aliases: ["runtime"],
        scope: {
          pathPrefix: ["android"],
          downstreamPrefix: ["jit"],
        },
        confidence: 0.9,
      },
    ];
    expect(resolveConceptPathWithEquivalences(["android", "runtime", "jit"], eq, {})).toEqual([
      "android",
      "art",
      "jit",
    ]);
    expect(resolveConceptPathWithEquivalences(["android", "runtime", "start"], eq, {})).toEqual([
      "android",
      "runtime",
      "start",
    ]);
  });

  it("uses summary in evidence matching", () => {
    expect(
      resolveConceptPathWithEquivalences(["android", "runtime", "start"], artRuntimeEq, {
        title: "Generic",
        summary: "libart module",
        items: [],
      })
    ).toEqual(["android", "art", "start"]);
  });

  it("reorders misplaced pathPrefix before applying scoped alias", () => {
    expect(
      resolveConceptPathWithEquivalences(
        ["runtime", "android", "art", "method-execution"],
        artRuntimeEq,
        { title: "ART entry_point", items: ["libart"] }
      )
    ).toEqual(["android", "art", "method-execution"]);
  });

  it("resolves cyclic scoped equivalences deterministically via topological sort", () => {
    const cyclic: SegmentEquivalence[] = [
      {
        canonical: "a",
        aliases: ["seg1"],
        scope: { pathPrefix: ["seg2"] },
        confidence: 0.9,
      },
      {
        canonical: "b",
        aliases: ["seg2"],
        scope: { pathPrefix: ["seg1"] },
        confidence: 0.9,
      },
    ];
    // Rule A wants seg2 before seg1; rule B wants seg1 before seg2. This is a
    // cycle. Topological sort detects it, keeps original order [seg1, seg2],
    // then the equivalence pass applies whichever rule's prefix is already
    // satisfied - here rule B (prefix [seg1] is before seg2 at index 1).
    expect(resolveConceptPathWithEquivalences(["seg1", "seg2"], cyclic, {})).toEqual(["seg1", "b"]);
  });

  it("applies multiple non-conflicting scoped equivalences in one pass", () => {
    // Old iterative fixpoint would move P to front (satisfying rule 1), then
    // move Q to front (displacing P, breaking rule 1). Topological sort
    // satisfies both constraints simultaneously: P before X, Q before Y.
    const eqs: SegmentEquivalence[] = [
      {
        canonical: "a",
        aliases: ["x"],
        scope: { pathPrefix: ["p"] },
        confidence: 0.9,
      },
      {
        canonical: "b",
        aliases: ["y"],
        scope: { pathPrefix: ["q"] },
        confidence: 0.9,
      },
    ];
    expect(resolveConceptPathWithEquivalences(["x", "p", "y", "q"], eqs, {})).toEqual([
      "p",
      "a",
      "q",
      "b",
    ]);
  });

  it("applies equivalence when pathPrefix sits mid-path instead of at position 0", () => {
    // Relaxed semantics: prefix [outer] is before alias [inner] but not at the
    // very start (a root segment precedes it). Old algorithm required prefix
    // at position 0 and would have reordered; new algorithm accepts the path
    // as-is and still applies the equivalence.
    const eq: SegmentEquivalence[] = [
      {
        canonical: "inner-canonical",
        aliases: ["inner"],
        scope: { pathPrefix: ["outer"] },
        confidence: 0.9,
      },
    ];
    expect(resolveConceptPathWithEquivalences(["root", "outer", "inner", "leaf"], eq, {})).toEqual([
      "root",
      "outer",
      "inner-canonical",
      "leaf",
    ]);
  });
});
