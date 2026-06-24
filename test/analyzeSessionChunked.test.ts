import { describe, it, expect } from "vitest";
import {
  splitEventsByTurns,
  mergeSessionAnalyses,
} from "../core/src/pipeline/stages/analyzeSessionChunked";
import type { ChatEvent } from "../core/src/transcript/types";
import type { SessionAnalysis } from "@agent-mindmap/shared";

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

/** Build a session with N turns (each: user_query + tool + assistant_summary). */
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

// ── splitEventsByTurns ──────────────────────────────────────────────────────

describe("splitEventsByTurns", () => {
  it("returns single chunk when turns ≤ maxTurnsPerChunk", () => {
    const events = buildSession(5);
    const chunks = splitEventsByTurns(events, 12);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(events);
  });

  it("returns single chunk when maxTurnsPerChunk is 0 (disabled)", () => {
    const events = buildSession(50);
    const chunks = splitEventsByTurns(events, 0);
    expect(chunks).toHaveLength(1);
  });

  it("splits sessions exceeding maxTurnsPerChunk", () => {
    const events = buildSession(25);
    const chunks = splitEventsByTurns(events, 12);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // All events are accounted for
    expect(chunks.flatMap((c) => c)).toHaveLength(events.length);
  });

  it("each chunk starts with a user_query (except possibly pre-query events)", () => {
    const events = buildSession(25);
    const chunks = splitEventsByTurns(events, 10);
    for (const chunk of chunks) {
      expect(chunk[0]?.kind).toBe("user_query");
    }
  });

  it("preserves all events across chunks", () => {
    const events = buildSession(30);
    const chunks = splitEventsByTurns(events, 12);
    const allChunks = chunks.flatMap((c) => c);
    expect(allChunks).toHaveLength(events.length);
  });

  it("handles session with events before first user_query", () => {
    // Tool call before any user query
    const events: ChatEvent[] = [toolCall("init", "Initialize", 0), ...buildSession(15)];
    const chunks = splitEventsByTurns(events, 12);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.flatMap((c) => c)).toHaveLength(events.length);
  });
});

// ── mergeSessionAnalyses ────────────────────────────────────────────────────

describe("mergeSessionAnalyses", () => {
  const baseAnalysis: SessionAnalysis = {
    domains: ["software", "backend"],
    nodes: [
      {
        key: "express",
        label: "Express",
        aliases: ["expressjs"],
        parentKeys: ["backend"],
        evidence: ["discussion of Express routing"],
      },
    ],
    segmentEquivalences: [
      {
        canonical: "express",
        aliases: ["expressjs"],
        scope: { pathPrefix: ["backend"] },
        confidence: 0.9,
      },
    ],
    termAliases: [{ canonical: "api", aliases: ["rest api"], evidence: ["REST endpoints"] }],
    outline: {
      title: "Backend Development",
      outline: [
        {
          title: "Express Routes",
          conceptPath: ["backend", "express", "routes"],
          details: [{ text: "Defined route handlers", sourceTurnIndices: [0, 2] }],
        },
      ],
    },
  };

  it("returns empty analysis for empty input", () => {
    const result = mergeSessionAnalyses([], []);
    expect(result.domains).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.segmentEquivalences).toEqual([]);
  });

  it("returns single analysis as-is when offset is 0", () => {
    const result = mergeSessionAnalyses([baseAnalysis], [0]);
    expect(result).toEqual(baseAnalysis);
  });

  it("merges domains from multiple analyses (union, dedup)", () => {
    const second: SessionAnalysis = {
      domains: ["backend", "devops"],
      nodes: [],
      segmentEquivalences: [],
    };
    const result = mergeSessionAnalyses([baseAnalysis, second], [0, 12]);
    expect(result.domains.sort()).toEqual(["backend", "devops", "software"]);
  });

  it("merges nodes deduplicating by key", () => {
    const second: SessionAnalysis = {
      domains: [],
      nodes: [
        {
          key: "express",
          label: "Express",
          aliases: ["express-framework"],
          parentKeys: ["backend"],
          evidence: ["more express discussion"],
        },
        {
          key: "docker",
          label: "Docker",
          parentKeys: ["devops"],
          evidence: ["container setup"],
        },
      ],
      segmentEquivalences: [],
    };
    const result = mergeSessionAnalyses([baseAnalysis, second], [0, 12]);
    // Express should be deduped with merged aliases
    expect(result.nodes).toHaveLength(2);
    const expressNode = result.nodes.find((n) => n.key === "express")!;
    expect(expressNode.aliases?.sort()).toEqual(["express-framework", "expressjs"]);
    expect(expressNode.evidence).toContain("discussion of Express routing");
    expect(expressNode.evidence).toContain("more express discussion");
    // Docker should be added
    expect(result.nodes.find((n) => n.key === "docker")).toBeDefined();
  });

  it("nests each sub-session outline under a Part N node (≤3 chunks)", () => {
    const second: SessionAnalysis = {
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      outline: {
        title: "Docker Setup",
        outline: [
          { title: "Docker Compose", details: [{ text: "Config file", sourceTurnIndices: [1] }] },
        ],
      },
    };
    const result = mergeSessionAnalyses([baseAnalysis, second], [0, 5]);
    expect(result.outline?.title).toBe("Backend Development");
    // Should have 2 top-level children: Part 1 and Part 2
    expect(result.outline?.outline).toHaveLength(2);
    expect(result.outline?.outline[0]?.title).toBe("Part 1");
    expect(result.outline?.outline[1]?.title).toBe("Part 2");
  });

  it("remaps sourceTurnIndices with turn offset", () => {
    const analysis: SessionAnalysis = {
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      outline: {
        title: "Part 2",
        outline: [
          {
            title: "Topic",
            details: [{ text: "point", sourceTurnIndices: [0, 3] }],
          },
        ],
      },
    };
    const result = mergeSessionAnalyses([analysis], [5]);
    const detail = result.outline?.outline[0]?.details?.[0];
    expect(detail?.sourceTurnIndices).toEqual([5, 8]);
  });

  it("concatenates code references deduping by path", () => {
    const first: SessionAnalysis = {
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      codeReferences: [
        {
          path: "src/index.ts",
          lines: "1-10",
          description: "Entry point",
        },
        {
          path: "src/app.ts",
          lines: "5-20",
          description: "App setup",
        },
      ],
    };
    const second: SessionAnalysis = {
      domains: [],
      nodes: [],
      segmentEquivalences: [],
      codeReferences: [
        {
          path: "src/index.ts",
          lines: "15-30",
          description: "Route handlers",
        },
        {
          path: "src/utils.ts",
          lines: "1-5",
          description: "Helpers",
        },
      ],
    };
    const result = mergeSessionAnalyses([first, second], [0, 10]);
    // src/index.ts should appear only once (first wins)
    expect(result.codeReferences?.map((r) => r.path).sort()).toEqual([
      "src/app.ts",
      "src/index.ts",
      "src/utils.ts",
    ]);
  });
});
