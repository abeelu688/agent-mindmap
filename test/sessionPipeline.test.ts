import { describe, expect, it } from "vitest";
import { runSessionPipeline } from "../extension/src/pipeline/sessionPipeline";
import type { LlmProvider, SessionAnalysis, SessionOutline } from "../extension/src/llm/types";
import type { ChatEvent } from "../extension/src/transcript/types";

const events: ChatEvent[] = [
  { kind: "user_query", text: "Explain React hooks", lineIndex: 0 },
];

const outline: SessionOutline = {
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
};

const sessionAnalysis: SessionAnalysis = {
  domains: ["frontend"],
  nodes: [
    {
      key: "react",
      label: "React",
      aliases: ["React"],
      parentKeys: ["frontend"],
      evidence: ["Explain React hooks"],
    },
  ],
  segmentEquivalences: [],
  outline,
};

describe("runSessionPipeline", () => {
  it("runs S1 analyze + S2 finalize with one LLM call", async () => {
    const stages: string[] = [];
    const provider: LlmProvider = {
      id: "fake",
      async summarize(input) {
        stages.push(input.responseSchema ?? "session-outline");
        if (input.responseSchema === "session-analysis") {
          return sessionAnalysis;
        }
        throw new Error(`unexpected schema ${input.responseSchema}`);
      },
    };

    const result = await runSessionPipeline(
      {
        events,
        sessionId: "s1",
        projectSlug: "proj-a",
        prompt: {
          maxDomains: 5,
          maxTerms: 10,
          maxEvidencePerTerm: 4,
          maxBranches: 6,
          maxDetailsPerNode: 6,
        },
        cache: false,
        skipTiming: true,
      },
      provider,
      new AbortController().signal
    );

    expect(stages).toEqual(["session-analysis"]);
    expect(result.outline.title).toBe("React Hooks");
    expect(result.sessionAnalysis.domains).toEqual(["frontend"]);
    expect(result.treeSnapshot.topicPathDecisions.length).toBeGreaterThan(0);
    expect(result.pipelineVersions.sessionAnalysis).toBe(4);
  });

  it("skips LLM when preloaded analysis is provided", async () => {
    let called = false;
    const provider: LlmProvider = {
      id: "fake",
      async summarize() {
        called = true;
        return sessionAnalysis;
      },
    };

    await runSessionPipeline(
      {
        events,
        sessionId: "s1",
        projectSlug: "proj-a",
        prompt: {
          maxDomains: 5,
          maxTerms: 10,
          maxEvidencePerTerm: 4,
          maxBranches: 6,
          maxDetailsPerNode: 6,
        },
        cache: false,
        skipTiming: true,
        preloaded: sessionAnalysis,
      },
      provider,
      new AbortController().signal
    );

    expect(called).toBe(false);
  });
});
