import { describe, expect, it } from "vitest";
import { buildSessionTree } from "../extension/src/pipeline/stages/buildSessionTree";
import type {
  SessionConceptExtract,
  SessionSynonymRefine,
} from "../extension/src/llm/types";

describe("buildSessionTree", () => {
  it("builds nodes and topic paths from extract + synonyms", () => {
    const extract: SessionConceptExtract = {
      domains: ["frontend"],
      terms: [
        {
          key: "react",
          label: "React",
          mentions: ["React", "ReactJS"],
          evidence: ["讨论 useState hooks"],
          suggestedParentKey: "frontend",
        },
      ],
    };
    const synonyms: SessionSynonymRefine = {
      segmentEquivalences: [],
      termAliases: [],
    };
    const tree = buildSessionTree(extract, synonyms, {
      sessionId: "s1",
      projectSlug: "proj-a",
    });
    expect(tree.nodes.some((n) => n.key === "react")).toBe(true);
    expect(tree.topicPathDecisions.length).toBe(1);
    expect(tree.topicPathDecisions[0].conceptPath).toContain("react");
    expect(tree.mappings.some((m) => m.mention === "ReactJS")).toBe(true);
  });

  it("applies session segment equivalences to paths", () => {
    const extract: SessionConceptExtract = {
      domains: ["frontend"],
      terms: [
        {
          key: "reactjs",
          label: "ReactJS",
          mentions: ["ReactJS"],
          evidence: ["React hooks 入门"],
          suggestedParentKey: "frontend",
        },
      ],
    };
    const synonyms: SessionSynonymRefine = {
      segmentEquivalences: [
        {
          canonical: "react",
          aliases: ["reactjs"],
          scope: {
            pathPrefix: ["frontend"],
            evidenceKeywords: ["hooks"],
          },
          confidence: 0.9,
        },
      ],
      termAliases: [],
    };
    const tree = buildSessionTree(extract, synonyms, {
      sessionId: "s1",
      projectSlug: "proj-a",
    });
    expect(tree.topicPathDecisions[0].conceptPath).toContain("react");
    expect(tree.topicPathDecisions[0].conceptPath).not.toContain("reactjs");
  });
});
