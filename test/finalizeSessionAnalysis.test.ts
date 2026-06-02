import { describe, expect, it } from "vitest";
import {
  analysisToConceptExtract,
  analysisToSessionSynonyms,
  finalizeSessionAnalysis,
} from "../extension/src/pipeline/stages/finalizeSessionAnalysis";
import type { SessionAnalysis } from "../extension/src/llm/types";

const analysis: SessionAnalysis = {
  domains: ["frontend"],
  nodes: [
    {
      key: "react",
      label: "React",
      aliases: ["ReactJS"],
      parentKeys: ["frontend"],
      evidence: ["Explain React hooks"],
    },
  ],
  segmentEquivalences: [],
  outline: {
    title: "React Hooks",
    outline: [
      {
        title: "Hooks",
        children: [
          {
            title: "useState",
            summary: "State hook",
            conceptPath: ["frontend", "react", "hooks"],
            details: [{ text: "Basic state", sourceTurnIndices: [0] }],
          },
        ],
      },
    ],
  },
};

describe("finalizeSessionAnalysis", () => {
  it("derives conceptExtract, sessionSynonyms, treeSnapshot, and graph", () => {
    const extract = analysisToConceptExtract(analysis);
    expect(extract.domains).toEqual(["frontend"]);
    expect(extract.terms[0]?.key).toBe("react");

    const synonyms = analysisToSessionSynonyms(analysis);
    expect(synonyms.segmentEquivalences).toEqual([]);

    const finalized = finalizeSessionAnalysis(analysis, {
      sessionId: "s1",
      projectSlug: "proj-a",
      userQueryCount: 1,
    });

    expect(finalized.outline.title).toBe("React Hooks");
    expect(finalized.graph.topics.length).toBeGreaterThan(0);
    expect(finalized.treeSnapshot.topicPathDecisions.length).toBeGreaterThan(0);
    expect(finalized.sessionAnalysis.outline.title).toBe("React Hooks");
    expect(finalized.conceptContexts.length).toBeGreaterThan(0);
    const react = finalized.conceptContexts.find((c) => c.key === "react");
    expect(react?.parentKeys).toEqual(["frontend"]);
    expect(react?.childKeys).toEqual([]);
    expect(react?.domainKeys).toContain("frontend");
  });
});
