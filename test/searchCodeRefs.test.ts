import { describe, expect, it } from "vitest";
import { searchProjectRecords } from "../shared/src/searchIndex";
import type { SessionRecord } from "../shared/src/storeTypes";

/**
 * A record whose ONLY signal matching "jwt verify leeway" lives in
 * `codeReferences[].description`. Outline/concept/evidence text deliberately
 * does not contain those words, so this record is unreachable on the pre-Q1
 * retrieval path.
 *
 * The codeRef is linked to turn 0 via sourceTurnIndices; the outline's detail
 * at turn 0 sits under a node with conceptPath ["backend","auth"], so the
 * reverse-boost should lift the "auth" concept hit when the codeRef matches.
 */
function recordWithCodeRef(): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sess-coderef",
      projectSlug: "home-example-proj",
      projectPath: "/home/example/proj",
      transcriptPath: "/tmp/sess-coderef.jsonl",
      transcriptMtimeMs: 1,
      analyzedAt: 5000,
      llm: { provider: "test" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Touch-up session",
    },
    outline: {
      title: "Touch-up session",
      summary: "Small adjustments, no specific theme discussed in prose.",
      outline: [
        {
          title: "Backend tweaks",
          summary: "Minor backend adjustments.",
          conceptPath: ["backend", "auth"],
          details: [{ text: "User reported a login edge case.", sourceTurnIndices: [0] }],
        },
      ],
    },
    conceptContexts: [
      {
        key: "auth",
        label: "Authentication",
        aliases: ["login security"],
        domainKeys: ["backend"],
        parentKeys: [],
        childKeys: [],
        evidence: ["User reported a login edge case."],
        sessionId: "sess-coderef",
        projectSlug: "home-example-proj",
      },
    ],
    sessionAnalysis: {
      domains: ["software"],
      nodes: [],
      segmentEquivalences: [],
      codeReferences: [
        {
          path: "src/auth/jwt.ts",
          lines: "42-57",
          description: "JWT verify with clock-skew leeway adjustment for token refresh.",
          sourceTurnIndices: [0],
        },
      ],
    },
  };
}

/** A record with no codeRef, to ensure codeRef-bearing records don't drown it out. */
function recordWithoutCodeRef(): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sess-discussion",
      projectSlug: "home-example-proj",
      projectPath: "/home/example/proj",
      transcriptPath: "/tmp/sess-discussion.jsonl",
      transcriptMtimeMs: 1,
      analyzedAt: 1000,
      llm: { provider: "test" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Design discussion",
    },
    outline: {
      title: "Design discussion",
      summary: "Whiteboard session about architecture.",
      outline: [{ title: "Architecture", summary: "Talked about layering." }],
    },
    conceptContexts: [],
  };
}

describe("codeReferences retrieval (Q1)", () => {
  const records = [recordWithoutCodeRef(), recordWithCodeRef()];

  it("hits a session via codeRef description when outline/concept text does not match", () => {
    // "clock-skew leeway" appears only in the codeRef description.
    const hits = searchProjectRecords(records, "clock-skew leeway", 5);
    expect(hits.length).toBeGreaterThan(0);
    const codeHits = hits.filter((h) => h.kind === "code");
    expect(codeHits.length).toBeGreaterThan(0);
    expect(codeHits[0].codePath).toBe("src/auth/jwt.ts");
    expect(codeHits[0].codeLines).toBe("42-57");
    expect(codeHits[0].sessionId).toBe("sess-coderef");
  });

  it("hits a session via codeRef path when queried by filename fragment", () => {
    const hits = searchProjectRecords(records, "jwt.ts", 5);
    expect(hits.length).toBeGreaterThan(0);
    const codeHits = hits.filter((h) => h.kind === "code");
    expect(codeHits.length).toBeGreaterThan(0);
    expect(codeHits[0].codePath).toBe("src/auth/jwt.ts");
  });

  it("reverse-boosts the owning concept when a linked codeRef matches", () => {
    // The auth concept has a weak match on "login" (via alias "login security"),
    // so it produces a low-score concept hit. The codeRef matches "jwt verify"
    // strongly and is linked to the auth concept via sourceTurnIndices →
    // outline detail → conceptPath. Reverse-boost should raise the auth
    // concept's score above what it would be without the codeRef.
    const baseRecord = recordWithCodeRef();
    // Strip the codeRef to get the baseline concept score.
    const { sessionAnalysis: _drop, ...withoutCodeRef } = baseRecord;
    void _drop;
    const baselineHits = searchProjectRecords([withoutCodeRef], "login jwt verify", 10);
    const baselineAuth = baselineHits.find((h) => h.kind === "concept" && h.conceptKey === "auth");
    const boostedHits = searchProjectRecords(records, "login jwt verify", 10);
    const boostedAuth = boostedHits.find((h) => h.kind === "concept" && h.conceptKey === "auth");
    expect(baselineAuth).toBeDefined();
    expect(boostedAuth).toBeDefined();
    expect(boostedAuth!.score).toBeGreaterThan(baselineAuth!.score);
  });

  it("caps code hits per session at MAX_HITS_PER_CODE", () => {
    // Build a record with many codeRefs all matching the same query word.
    const refs = Array.from({ length: 10 }, (_, i) => ({
      path: `src/mod${i}/jwt.ts`,
      lines: "1-2",
      description: "jwt verify helper",
      sourceTurnIndices: [0],
    }));
    const record: SessionRecord = {
      ...recordWithCodeRef(),
      sessionAnalysis: {
        domains: ["software"],
        nodes: [],
        segmentEquivalences: [],
        codeReferences: refs,
      },
    };
    const hits = searchProjectRecords([record], "jwt verify", 20);
    const codeHits = hits.filter((h) => h.kind === "code");
    expect(codeHits.length).toBeLessThanOrEqual(2);
  });
});
