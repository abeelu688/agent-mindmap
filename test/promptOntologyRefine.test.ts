import { describe, expect, it } from "vitest";
import {
  buildOntologyRefinePrompt,
  buildRefineInputFromRecords,
  ONTOLOGY_REFINE_PROMPT_VERSION,
} from "../extension/src/llm/promptOntologyRefine";

describe("promptOntologyRefine", () => {
  it("uses refine prompt version 3 with contextSamples", () => {
    expect(ONTOLOGY_REFINE_PROMPT_VERSION).toBe(3);
    const input = buildRefineInputFromRecords(
      [],
      { nodes: [], mappings: [] },
      [
        {
          topicId: "t1",
          sessionId: "s1",
          projectSlug: "p",
          conceptPath: ["android", "runtime"],
        },
      ]
    );
    expect(input.contextSamples).toHaveLength(1);
    expect(input.contextSamples[0].segments.length).toBe(2);
    const prompt = buildOntologyRefinePrompt(input);
    expect(prompt).toContain("contextSamples");
    expect(prompt).toContain("downstreamPrefix");
    expect(prompt).toContain("pathPrefix");
  });
});
