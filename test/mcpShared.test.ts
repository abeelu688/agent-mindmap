import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { bumpMcpProjectRevision, readMcpIndex } from "../shared/src/mcpIndex";
import {
  renderConceptDetail,
  renderMemoryRetrieval,
  renderProjectBriefing,
  renderSearchResults,
  renderSessionOutlineMarkdown,
} from "../shared/src/markdownRender";
import { workspaceToSlug } from "../shared/src/paths";
import { searchProjectRecords } from "../shared/src/searchIndex";
import {
  ontologyCachePath,
  ontologyIndexPath,
  readLatestProjectSegmentEquivalences,
} from "../shared/src/storeReader";
import type { ConceptContextForMerge, SessionRecord } from "../shared/src/storeTypes";

function sampleRecord(overrides?: Partial<SessionRecord["meta"]>): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId: "sess-1",
      projectSlug: "home-example-proj",
      projectPath: "/home/example/proj",
      transcriptPath: "/tmp/sess-1.jsonl",
      transcriptMtimeMs: 1,
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: "Fix auth bug",
      ...overrides,
    },
    outline: {
      title: "Authentication fix",
      summary: "Investigated JWT refresh failures in login flow.",
      outline: [
        {
          title: "Token refresh",
          summary: "Refresh endpoint returned 401 when clock skew exceeded tolerance.",
          details: [{ text: "Adjusted leeway in verify options." }],
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
        childKeys: ["jwt"],
        evidence: ["Refresh endpoint returned 401 under clock skew."],
        sessionId: "sess-1",
        projectSlug: "home-example-proj",
      },
    ],
  };
}

describe("workspaceToSlug (shared)", () => {
  it("encodes unix absolute paths", () => {
    expect(workspaceToSlug("/home/example/cursor/airecorder")).toBe(
      "home-example-cursor-airecorder"
    );
  });
});

describe("searchProjectRecords", () => {
  it("matches concept evidence and returns evidence hits first", () => {
    const hits = searchProjectRecords([sampleRecord()], "clock skew", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].kind).toBe("evidence");
    expect(hits[0].sessionId).toBe("sess-1");
    expect(hits[0].evidenceIndex).toBe(0);
    expect(hits[0].snippet).toContain("clock skew");
  });

  it("expands queries through concept aliases", () => {
    const hits = searchProjectRecords([sampleRecord()], "login security", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].conceptKey).toBe("auth");
    expect(hits.some((hit) => hit.kind === "evidence")).toBe(true);
  });

  it("expands queries through segment equivalences", () => {
    const hits = searchProjectRecords([sampleRecord()], "signin", 5, [
      {
        canonical: "auth",
        aliases: ["signin"],
        scope: { projectSlugs: ["home-example-proj"] },
        confidence: 0.9,
      },
    ]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].conceptKey).toBe("auth");
    expect(hits.some((hit) => hit.kind === "evidence")).toBe(true);
  });

  it("keeps retrieval results diverse across sessions", () => {
    const recordA = sampleRecord({ sessionId: "sess-a", analyzedAt: 1000 });
    recordA.conceptContexts = [
      {
        key: "auth",
        label: "Authentication",
        domainKeys: ["backend"],
        parentKeys: [],
        childKeys: ["jwt"],
        evidence: [
          "retry token refresh failure during login",
          "retry login refresh when jwt expires",
          "retry auth request after skew correction",
          "retry refresh endpoint after transient failure",
        ],
        sessionId: "sess-a",
        projectSlug: "home-example-proj",
      },
    ];
    const recordB = sampleRecord({ sessionId: "sess-b", analyzedAt: 2000 });
    recordB.conceptContexts = [
      {
        key: "mcp",
        label: "MCP retrieval",
        domainKeys: ["agent-memory"],
        parentKeys: [],
        childKeys: [],
        evidence: ["retry project memory retrieval when local index is refreshed"],
        sessionId: "sess-b",
        projectSlug: "home-example-proj",
      },
    ];

    const hits = searchProjectRecords([recordA, recordB], "retry", 4);
    expect(hits.some((hit) => hit.sessionId === "sess-a")).toBe(true);
    expect(hits.some((hit) => hit.sessionId === "sess-b")).toBe(true);
    expect(hits.filter((hit) => hit.sessionId === "sess-a").length).toBeLessThanOrEqual(3);
  });
});

describe("markdown renderers", () => {
  it("renders session outline with sessionId reference", () => {
    const md = renderSessionOutlineMarkdown(sampleRecord());
    expect(md).toContain("sess-1");
    expect(md).toContain("Authentication fix");
  });

  it("renders project briefing for recent sessions", () => {
    const md = renderProjectBriefing({
      projectSlug: "home-example-proj",
      records: [sampleRecord()],
    });
    expect(md).toContain("home-example-proj");
    expect(md).toContain("sess-1");
  });

  it("renders concept detail with evidence citations", () => {
    const contexts: ConceptContextForMerge[] = sampleRecord().conceptContexts ?? [];
    const md = renderConceptDetail("auth", contexts, [sampleRecord()]);
    expect(md).toContain("Authentication");
    expect(md).toContain("[sess-1]");
  });

  it("renders empty search message", () => {
    const md = renderSearchResults("missing-term", [], 5);
    expect(md).toContain("missing-term");
  });

  it("renders retrieved memory as a context pack", () => {
    const hits = searchProjectRecords([sampleRecord()], "clock skew", 5);
    const md = renderMemoryRetrieval("clock skew", hits, 5);
    expect(md).toContain("Project memory for: clock skew");
    expect(md).toContain("Most relevant evidence");
    expect(md).toContain("Source sessions");
    expect(md).toContain("sess-1");
  });
});

describe("ontology equivalence reader", () => {
  it("loads latest project segment equivalences from ontology cache", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amm-ontology-"));
    try {
      await fs.mkdir(path.dirname(ontologyCachePath(storeDir, "cache-a")), { recursive: true });
      await fs.writeFile(
        ontologyIndexPath(storeDir),
        JSON.stringify({
          schemaVersion: 1,
          updatedAt: 2,
          entries: [
            {
              cacheKey: "cache-a",
              builtAt: 2,
              sessionIds: ["sess-1"],
              projectSlugs: ["home-example-proj"],
            },
          ],
        }),
        "utf8"
      );
      await fs.writeFile(
        ontologyCachePath(storeDir, "cache-a"),
        JSON.stringify({
          schemaVersion: 1,
          segmentEquivalences: [
            {
              canonical: "auth",
              aliases: ["signin"],
              scope: { projectSlugs: ["home-example-proj"] },
              confidence: 0.9,
            },
          ],
        }),
        "utf8"
      );

      const equivalences = await readLatestProjectSegmentEquivalences(
        storeDir,
        "home-example-proj"
      );
      expect(equivalences).toHaveLength(1);
      expect(equivalences[0].aliases).toContain("signin");
    } finally {
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });
});

describe("mcp index revision", () => {
  it("bumps project revision on refresh", async () => {
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "amm-mcp-"));
    try {
      const first = await bumpMcpProjectRevision(storeDir, "proj-a", 3);
      expect(first.projects["proj-a"].revision).toBe(1);
      const second = await bumpMcpProjectRevision(storeDir, "proj-a", 4);
      expect(second.projects["proj-a"].revision).toBe(2);
      const loaded = await readMcpIndex(storeDir);
      expect(loaded.projects["proj-a"].recordCount).toBe(4);
    } finally {
      await fs.rm(storeDir, { recursive: true, force: true });
    }
  });
});
