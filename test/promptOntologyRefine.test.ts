import { describe, expect, it } from "vitest";
import {
  buildOntologyRefinePrompt,
  buildRefineInputFromRecords,
  ONTOLOGY_REFINE_PROMPT_VERSION,
} from "../extension/src/llm/promptOntologyRefine";

describe("promptOntologyRefine", () => {
  it("uses refine prompt version 5 with contextSamples and overlapHints", () => {
    expect(ONTOLOGY_REFINE_PROMPT_VERSION).toBe(5);
    const input = buildRefineInputFromRecords(
      [],
      { nodes: [], mappings: [] },
      [
        {
          topicId: "t1",
          sessionId: "s1",
          projectSlug: "p",
          conceptPath: ["platform-alpha", "core", "module-a"],
        },
        {
          topicId: "t2",
          sessionId: "s2",
          projectSlug: "p",
          conceptPath: ["platform-beta", "core", "module-a"],
        },
        {
          topicId: "t3",
          sessionId: "s1",
          projectSlug: "p",
          conceptPath: ["platform-alpha", "core", "module-b"],
        },
        {
          topicId: "t4",
          sessionId: "s2",
          projectSlug: "p",
          conceptPath: ["platform-beta", "core", "module-b"],
        },
      ]
    );
    expect(input.contextSamples).toHaveLength(4);
    expect(input.contextSamples[0].segments.length).toBe(3);
    expect(input.overlapHints.length).toBeGreaterThan(0);
    expect(input.overlapHints[0].sharedDownstreamFirst).toContain("core");
    const prompt = buildOntologyRefinePrompt(input);
    expect(prompt).toContain("contextSamples");
    expect(prompt).toContain("overlapHints");
    expect(prompt).toContain("kind=chain");
    expect(prompt).toContain("domain + 上级节点 + 下级节点");
    expect(prompt).toContain("downstreamFirst");
    expect(prompt).toContain("pathPrefix");
    expect(prompt).toContain('"canonical":"api"');
    expect(prompt).not.toContain("libart");
  });
});
