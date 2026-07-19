import { describe, it, expect } from "vitest";
import { mergeOutlinesForDisplay } from "@agent-mindmap/shared";
import {
  isVirtualSessionId,
  virtualSessionId,
  parseVirtualSessionId,
  computeTurnHashes,
  listVirtualSessions,
  nextVirtualSessionIndex,
  buildStoredTurnHashes,
  detectTurnDelta,
  groupEventsByTurn,
  sliceEventsByTurns,
  buildContextPrimerFromRecords,
  readMergedSessionRecord,
} from "../core/src/store/virtualSession";
import type { ChatEvent } from "../core/src/transcript/types";
import type { SessionRecord, Store } from "@agent-mindmap/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

function userQuery(text: string, lineIndex = 0): ChatEvent {
  return { kind: "user_query", text, lineIndex };
}
function toolCall(name: string, label: string, lineIndex = 0): ChatEvent {
  return { kind: "tool", name, label, lineIndex, filePaths: [] };
}
function assistantSummary(text: string, lineIndex = 0): ChatEvent {
  return { kind: "assistant_summary", text, preview: text.slice(0, 50), lineIndex };
}

function buildSession(turnCount: number): ChatEvent[] {
  const events: ChatEvent[] = [];
  let lineIndex = 0;
  for (let i = 0; i < turnCount; i++) {
    events.push(userQuery(`Query ${i + 1}`, lineIndex++));
    events.push(toolCall(`tool_${i}`, `Tool ${i}`, lineIndex++));
    events.push(assistantSummary(`Summary ${i + 1}`, lineIndex++));
  }
  return events;
}

function makeRecord(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sid-1",
      projectSlug: "proj",
      projectPath: "/proj",
      transcriptPath: "/proj/t.jsonl",
      transcriptFreshnessToken: "3",
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
      promptVersion: 1,
      sessionLabel: "Session 1",
      hostId: "cursor",
      userQueryCount: 3,
      outputLanguage: "English",
      ...overrides.meta,
    },
    outline: {
      title: "Outline",
      outline: [],
      ...(overrides.outline ?? {}),
    },
    graph: { title: "Outline", topics: [] },
    sessionAnalysis: overrides.sessionAnalysis,
    conceptExtract: overrides.conceptExtract,
    sessionSynonyms: overrides.sessionSynonyms,
    treeSnapshot: overrides.treeSnapshot,
    conceptContexts: overrides.conceptContexts,
  };
}

function makeStore(records: SessionRecord[]): Store {
  return {
    async getRecord(projectSlug: string, sessionId: string) {
      return records.find(
        (r) => r.meta.projectSlug === projectSlug && r.meta.sessionId === sessionId
      );
    },
    async listRecordsForProject(projectSlug: string) {
      return records.filter((r) => r.meta.projectSlug === projectSlug);
    },
  } as unknown as Store;
}

// ── ID helpers ───────────────────────────────────────────────────────────────

describe("virtualSessionId / parseVirtualSessionId / isVirtualSessionId", () => {
  it("builds 1-based #v<N> suffix", () => {
    expect(virtualSessionId("abc", 1)).toBe("abc#v1");
    expect(virtualSessionId("abc", 3)).toBe("abc#v3");
  });

  it("throws for index < 1", () => {
    expect(() => virtualSessionId("abc", 0)).toThrow();
    expect(() => virtualSessionId("abc", -1)).toThrow();
  });

  it("parses valid virtual ids", () => {
    expect(parseVirtualSessionId("abc#v1")).toEqual({ parentSessionId: "abc", index: 1 });
    expect(parseVirtualSessionId("abc#v5")).toEqual({ parentSessionId: "abc", index: 5 });
  });

  it("returns undefined for original session ids (no #v suffix)", () => {
    expect(parseVirtualSessionId("abc")).toBeUndefined();
    expect(parseVirtualSessionId("abc-def")).toBeUndefined();
  });

  it("returns undefined for malformed suffixes", () => {
    expect(parseVirtualSessionId("abc#v0")).toBeUndefined(); // 0 not allowed
    expect(parseVirtualSessionId("abc#v")).toBeUndefined();
    expect(parseVirtualSessionId("abc#vx")).toBeUndefined();
    expect(parseVirtualSessionId("#v1")).toBeUndefined(); // empty parent
    expect(parseVirtualSessionId("abc#v01")).toBeUndefined(); // leading zero
  });

  it("isVirtualSessionId matches parseVirtualSessionId", () => {
    expect(isVirtualSessionId("abc#v1")).toBe(true);
    expect(isVirtualSessionId("abc")).toBe(false);
    expect(isVirtualSessionId("abc#v0")).toBe(false);
  });
});

// ── Turn hashing ─────────────────────────────────────────────────────────────

describe("computeTurnHashes", () => {
  it("produces one hash per turn", () => {
    const events = buildSession(3);
    const hashes = computeTurnHashes(events);
    expect(hashes).toHaveLength(3);
    for (const h of hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("stays stable when content is unchanged", () => {
    const events1 = buildSession(3);
    const events2 = buildSession(3);
    expect(computeTurnHashes(events1)).toEqual(computeTurnHashes(events2));
  });

  it("changes when a turn's query is edited", () => {
    const events = buildSession(3);
    const original = computeTurnHashes(events);
    events[0]!.text = "Edited query";
    const edited = computeTurnHashes(events);
    expect(edited[0]).not.toBe(original[0]);
    // Later turns are unchanged
    expect(edited[1]).toBe(original[1]);
    expect(edited[2]).toBe(original[2]);
  });

  it("changes when a turn's summary is edited", () => {
    const events = buildSession(2);
    const original = computeTurnHashes(events);
    events[5]!.text = "Edited summary";
    const edited = computeTurnHashes(events);
    expect(edited[1]).not.toBe(original[1]);
    expect(edited[0]).toBe(original[0]);
  });

  it("changes when a tool call label is edited", () => {
    const events = buildSession(2);
    const original = computeTurnHashes(events);
    events[1]!.label = "Edited tool";
    const edited = computeTurnHashes(events);
    expect(edited[0]).not.toBe(original[0]);
  });
});

// ── Delta detection ──────────────────────────────────────────────────────────

describe("detectTurnDelta", () => {
  it("returns fresh when stored and current match", () => {
    const hashes = ["a", "b", "c"];
    expect(detectTurnDelta(hashes, hashes)).toEqual({ kind: "fresh", startTurnIndex: 3 });
  });

  it("returns append when stored is a prefix of current", () => {
    const stored = ["a", "b"];
    const current = ["a", "b", "c", "d"];
    expect(detectTurnDelta(stored, current)).toEqual({ kind: "append", startTurnIndex: 2 });
  });

  it("returns edit when current is shorter than stored (turns deleted)", () => {
    const stored = ["a", "b", "c"];
    const current = ["a", "b"];
    expect(detectTurnDelta(stored, current)).toEqual({ kind: "edit", startTurnIndex: 2 });
  });

  it("returns edit when a middle turn changes", () => {
    const stored = ["a", "b", "c"];
    const current = ["a", "X", "c"];
    expect(detectTurnDelta(stored, current)).toEqual({ kind: "edit", startTurnIndex: 1 });
  });

  it("returns edit when first turn changes", () => {
    const stored = ["a", "b", "c"];
    const current = ["X", "b", "c"];
    expect(detectTurnDelta(stored, current)).toEqual({ kind: "edit", startTurnIndex: 0 });
  });

  it("returns fresh when both are empty", () => {
    expect(detectTurnDelta([], [])).toEqual({ kind: "fresh", startTurnIndex: 0 });
  });

  it("returns append when stored is empty and current has turns", () => {
    expect(detectTurnDelta([], ["a"])).toEqual({ kind: "append", startTurnIndex: 0 });
  });
});

// ── buildStoredTurnHashes ────────────────────────────────────────────────────

describe("buildStoredTurnHashes", () => {
  it("returns undefined when original has no turnHashes (legacy)", () => {
    const original = makeRecord({ meta: { turnHashes: undefined } } as any);
    expect(buildStoredTurnHashes(original, [])).toBeUndefined();
  });

  it("returns original's hashes when no virtuals", () => {
    const original = makeRecord({
      meta: { turnHashes: ["a", "b"] },
    } as any);
    expect(buildStoredTurnHashes(original, [])).toEqual(["a", "b"]);
  });

  it("concatenates original + virtuals in virtualSessionIndex order", () => {
    const original = makeRecord({
      meta: { turnHashes: ["a", "b"] },
    } as any);
    const v2 = makeRecord({
      meta: {
        sessionId: "sid-1#v2",
        parentSessionId: "sid-1",
        virtualSessionIndex: 2,
        turnHashes: ["c", "d"],
      },
    } as any);
    const v1 = makeRecord({
      meta: {
        sessionId: "sid-1#v1",
        parentSessionId: "sid-1",
        virtualSessionIndex: 1,
        turnHashes: ["e", "f"],
      },
    } as any);
    // Pass them out of order; function should sort by index.
    expect(buildStoredTurnHashes(original, [v2, v1])).toEqual(["a", "b", "e", "f", "c", "d"]);
  });

  it("returns undefined when any virtual lacks turnHashes (corrupt/legacy)", () => {
    const original = makeRecord({
      meta: { turnHashes: ["a", "b"] },
    } as any);
    const v1 = makeRecord({
      meta: {
        sessionId: "sid-1#v1",
        parentSessionId: "sid-1",
        virtualSessionIndex: 1,
        turnHashes: undefined,
      },
    } as any);
    expect(buildStoredTurnHashes(original, [v1])).toBeUndefined();
  });
});

// ── nextVirtualSessionIndex ──────────────────────────────────────────────────

describe("nextVirtualSessionIndex", () => {
  it("returns 1 when no virtuals exist", () => {
    expect(nextVirtualSessionIndex([])).toBe(1);
  });

  it("returns max+1 for existing virtuals", () => {
    const v1 = makeRecord({ meta: { virtualSessionIndex: 1 } } as any);
    const v3 = makeRecord({ meta: { virtualSessionIndex: 3 } } as any);
    const v2 = makeRecord({ meta: { virtualSessionIndex: 2 } } as any);
    expect(nextVirtualSessionIndex([v1, v3, v2])).toBe(4);
  });

  it("handles virtuals missing virtualSessionIndex (treats as 0)", () => {
    const v1 = makeRecord({ meta: { virtualSessionIndex: 1 } } as any);
    const vBad = makeRecord({ meta: { virtualSessionIndex: undefined } } as any);
    expect(nextVirtualSessionIndex([v1, vBad])).toBe(2);
  });
});

// ── Event slicing ────────────────────────────────────────────────────────────

describe("groupEventsByTurn / sliceEventsByTurns", () => {
  it("groups events by user_query boundary", () => {
    const events = buildSession(3);
    const groups = groupEventsByTurn(events);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(3); // user_query + tool + assistant_summary
    expect(groups[1]).toHaveLength(3);
    expect(groups[2]).toHaveLength(3);
  });

  it("sliceEventsByTurns returns events for [start, end)", () => {
    const events = buildSession(5);
    const slice = sliceEventsByTurns(events, 1, 3);
    expect(slice).toHaveLength(6); // 2 turns × 3 events each
    expect(slice[0]).toBe(events[3]); // turn 1's first event
    expect(slice[5]).toBe(events[8]); // turn 2's last event
  });

  it("sliceEventsByTurns returns empty for invalid range", () => {
    const events = buildSession(3);
    expect(sliceEventsByTurns(events, 2, 1)).toEqual([]);
    expect(sliceEventsByTurns(events, -1, 2)).toEqual([]);
    expect(sliceEventsByTurns(events, 5, 10)).toEqual([]);
  });

  it("sliceEventsByTurns clamps end to available turns", () => {
    const events = buildSession(3);
    const slice = sliceEventsByTurns(events, 1, 100);
    expect(slice).toHaveLength(6); // 2 turns × 3 events each
  });
});

// ── listVirtualSessions ──────────────────────────────────────────────────────

describe("listVirtualSessions", () => {
  it("filters by parentSessionId and sorts by index", async () => {
    const v1 = makeRecord({
      meta: {
        sessionId: "sid-1#v1",
        parentSessionId: "sid-1",
        virtualSessionIndex: 1,
      },
    } as any);
    const v2 = makeRecord({
      meta: {
        sessionId: "sid-1#v2",
        parentSessionId: "sid-1",
        virtualSessionIndex: 2,
      },
    } as any);
    const other = makeRecord({
      meta: {
        sessionId: "other#v1",
        parentSessionId: "other",
        virtualSessionIndex: 1,
      },
    } as any);
    const store = makeStore([v2, v1, other]);

    const result = await listVirtualSessions(store, "proj", "sid-1");
    expect(result).toEqual([v1, v2]);
  });

  it("returns empty array when no virtuals exist", async () => {
    const store = makeStore([]);
    const result = await listVirtualSessions(store, "proj", "sid-1");
    expect(result).toEqual([]);
  });
});

// ── buildContextPrimerFromRecords ────────────────────────────────────────────

describe("buildContextPrimerFromRecords", () => {
  it("collects leaf topics from original + virtuals", () => {
    const original = makeRecord({
      outline: {
        title: "Orig",
        outline: [
          {
            title: "Topic A",
            children: [{ title: "Leaf A1", details: [{ text: "a1" }] }],
          },
        ],
      },
    });
    const v1 = makeRecord({
      outline: {
        title: "V1",
        outline: [{ title: "Leaf V1-1", details: [{ text: "v1-1" }] }],
      },
      meta: { virtualSessionIndex: 1, parentSessionId: "sid-1" } as any,
    });

    const primer = buildContextPrimerFromRecords(original, [v1]);
    expect(primer.originalSessionLabel).toBe("Session 1");
    expect(primer.virtualSessionIndex).toBe(2); // next after v1
    // Non-leaf "Topic A" should be skipped; only leaves collected
    expect(primer.priorTopics.map((t) => t.title)).toEqual(["Leaf A1", "Leaf V1-1"]);
  });

  it("dedups code refs by path (original first)", () => {
    const original = makeRecord({
      sessionAnalysis: {
        codeReferences: [
          { path: "/proj/a.ts", description: "orig a" },
          { path: "/proj/b.ts", description: "orig b" },
        ],
        domains: [],
        nodes: [],
        segmentEquivalences: [],
        termAliases: [],
      } as any,
    });
    const v1 = makeRecord({
      sessionAnalysis: {
        codeReferences: [
          { path: "/proj/a.ts", description: "v1 a (dup)" },
          { path: "/proj/c.ts", description: "v1 c" },
        ],
        domains: [],
        nodes: [],
        segmentEquivalences: [],
        termAliases: [],
      } as any,
      meta: { virtualSessionIndex: 1, parentSessionId: "sid-1" } as any,
    });

    const primer = buildContextPrimerFromRecords(original, [v1]);
    expect(primer.priorCodeRefs).toEqual([
      { path: "/proj/a.ts", description: "orig a" },
      { path: "/proj/b.ts", description: "orig b" },
      { path: "/proj/c.ts", description: "v1 c" },
    ]);
  });
});

// ── mergeOutlinesForDisplay (shared) ─────────────────────────────────────────

describe("mergeOutlinesForDisplay", () => {
  it("returns undefined for empty input", () => {
    expect(mergeOutlinesForDisplay([])).toBeUndefined();
  });

  it("returns original unchanged when no virtuals", () => {
    const original = makeRecord({
      outline: { title: "Orig", outline: [{ title: "T1", details: [{ text: "d1" }] }] },
    });
    const merged = mergeOutlinesForDisplay([original]);
    expect(merged?.outline.outline).toEqual([{ title: "T1", details: [{ text: "d1" }] }]);
  });

  it("wraps each record's outline under Part N for ≤3 records", () => {
    const original = makeRecord({
      outline: { title: "Orig", outline: [{ title: "T1", details: [{ text: "d1" }] }] },
    });
    const v1 = makeRecord({
      outline: { title: "V1", outline: [{ title: "T2", details: [{ text: "d2" }] }] },
      meta: { virtualSessionIndex: 1, parentSessionId: "sid-1" } as any,
    });
    const merged = mergeOutlinesForDisplay([original, v1]);
    expect(merged?.outline.outline).toEqual([
      { title: "Part 1", children: [{ title: "T1", details: [{ text: "d1" }] }] },
      { title: "Part 2", children: [{ title: "T2", details: [{ text: "d2" }] }] },
    ]);
  });

  it("flat-concats outlines for >3 records", () => {
    const records: SessionRecord[] = [];
    for (let i = 0; i < 4; i++) {
      records.push(
        makeRecord({
          outline: {
            title: `R${i}`,
            outline: [{ title: `T${i}`, details: [{ text: `d${i}` }] }],
          },
        })
      );
    }
    const merged = mergeOutlinesForDisplay(records);
    expect(merged?.outline.outline.map((n) => n.title)).toEqual(["T0", "T1", "T2", "T3"]);
  });

  it("dedups code refs by path (original first)", () => {
    const original = makeRecord({
      sessionAnalysis: {
        codeReferences: [{ path: "/a.ts", description: "orig" }],
        domains: [],
        nodes: [],
        segmentEquivalences: [],
        termAliases: [],
      } as any,
    });
    const v1 = makeRecord({
      sessionAnalysis: {
        codeReferences: [
          { path: "/a.ts", description: "v1 dup" },
          { path: "/b.ts", description: "v1 new" },
        ],
        domains: [],
        nodes: [],
        segmentEquivalences: [],
        termAliases: [],
      } as any,
    });
    const merged = mergeOutlinesForDisplay([original, v1]);
    expect(merged?.sessionAnalysis?.codeReferences).toEqual([
      { path: "/a.ts", description: "orig" },
      { path: "/b.ts", description: "v1 new" },
    ]);
  });
});

// ── readMergedSessionRecord ──────────────────────────────────────────────────

describe("readMergedSessionRecord", () => {
  it("returns undefined when original not found", async () => {
    const store = makeStore([]);
    expect(await readMergedSessionRecord(store, "proj", "missing")).toBeUndefined();
  });

  it("returns original unchanged when no turnHashes (legacy record)", async () => {
    const original = makeRecord({ meta: { turnHashes: undefined } } as any);
    const store = makeStore([original]);
    expect(await readMergedSessionRecord(store, "proj", "sid-1")).toBe(original);
  });

  it("returns original unchanged when no virtual sessions exist", async () => {
    const original = makeRecord({
      meta: { turnHashes: ["a", "b"] },
      outline: { title: "Orig", outline: [{ title: "T1", details: [{ text: "d1" }] }] },
    } as any);
    const store = makeStore([original]);
    expect(await readMergedSessionRecord(store, "proj", "sid-1")).toBe(original);
  });

  it("merges original + virtuals into a single view", async () => {
    const original = makeRecord({
      meta: { turnHashes: ["a", "b"] },
      outline: { title: "Orig", outline: [{ title: "T1", details: [{ text: "d1" }] }] },
    } as any);
    const v1 = makeRecord({
      meta: {
        sessionId: "sid-1#v1",
        parentSessionId: "sid-1",
        virtualSessionIndex: 1,
        turnHashes: ["c"],
      } as any,
      outline: { title: "V1", outline: [{ title: "T2", details: [{ text: "d2" }] }] },
    });
    const store = makeStore([original, v1]);

    const merged = await readMergedSessionRecord(store, "proj", "sid-1");
    expect(merged).toBeDefined();
    expect(merged?.outline.outline).toHaveLength(2); // Part 1 + Part 2
    expect(merged?.outline.outline[0]?.title).toBe("Part 1");
    expect(merged?.outline.outline[1]?.title).toBe("Part 2");
    // Meta comes from original
    expect(merged?.meta.sessionId).toBe("sid-1");
  });
});
