import { describe, expect, it } from "vitest";
import { validateSessionAnalysis } from "../extension/src/llm/pipelineValidate";
import { LlmProviderError } from "../extension/src/llm/types";

const validAnalysis = {
  domains: ["frontend"],
  nodes: [
    {
      key: "react",
      label: "React",
      aliases: ["ReactJS"],
      parentKeys: ["frontend"],
      evidence: ["Discuss React hooks"],
    },
  ],
  mappings: [],
  segmentEquivalences: [
    {
      canonical: "hooks",
      aliases: ["react hooks"],
      scope: { evidenceKeywords: ["hooks"] },
      evidence: ["hooks vs react hooks"],
    },
  ],
  termAliases: [
    {
      canonical: "react",
      aliases: ["ReactJS"],
      evidence: ["ReactJS mentioned"],
    },
  ],
  outline: {
    title: "React",
    outline: [
      {
        title: "Hooks",
        children: [
          {
            title: "useState",
            summary: "State management",
            conceptPath: ["frontend", "react", "hooks"],
            details: [{ text: "Basic state", sourceTurnIndices: [0] }],
          },
        ],
      },
    ],
  },
};

describe("validateSessionAnalysis", () => {
  it("accepts a well-formed session analysis", () => {
    const result = validateSessionAnalysis(validAnalysis);
    expect(result.domains).toEqual(["frontend"]);
    expect(result.nodes[0]?.key).toBe("react");
    expect(result.outline.title).toBe("React");
    expect(result.segmentEquivalences).toHaveLength(1);
  });

  it("rejects analysis without nodes", () => {
    expect(() =>
      validateSessionAnalysis({
        ...validAnalysis,
        nodes: [],
      })
    ).toThrow(LlmProviderError);
  });

  it("silently drops segment equivalences without scope", () => {
    const result = validateSessionAnalysis({
      ...validAnalysis,
      segmentEquivalences: [
        { canonical: "hooks", aliases: ["react hooks"], evidence: ["x"] },
      ],
    });
    expect(result.segmentEquivalences).toHaveLength(0);
  });

  it("skips outline validation when requireOutline is false", () => {
    const result = validateSessionAnalysis(
      { ...validAnalysis, outline: undefined },
      { requireOutline: false }
    );
    expect(result.domains).toEqual(["frontend"]);
    expect(result.outline).toBeUndefined();
  });

  it("skips codeReferences validation when requireCodeReferences is false", () => {
    const result = validateSessionAnalysis(
      { ...validAnalysis, codeReferences: undefined },
      { requireCodeReferences: false }
    );
    expect(result.domains).toEqual(["frontend"]);
    expect(result.codeReferences).toBeUndefined();
  });
});
