import { describe, expect, it } from "vitest";
import {
  buildAllSegmentOverlapHints,
  buildChainCollapseOverlapHints,
  deriveEquivalencesFromTopicPaths,
} from "../extension/src/llm/synonymHintDerive";
import type { TopicConceptPathDecision } from "../extension/src/store/ontologyTypes";
import type { ConceptOntologyNode } from "../extension/src/llm/types";

describe("synonymHintDerive", () => {
  it("detects chain collapse outer/inner on same path prefix", () => {
    const topicPaths: TopicConceptPathDecision[] = [
      {
        topicId: "t1",
        sessionId: "s1",
        projectSlug: "p",
        conceptPath: ["platform-wrapper", "subsystem", "module-a"],
      },
      {
        topicId: "t2",
        sessionId: "s2",
        projectSlug: "p",
        conceptPath: ["platform-wrapper", "subsystem", "module-a"],
      },
      {
        topicId: "t3",
        sessionId: "s3",
        projectSlug: "p",
        conceptPath: ["subsystem", "module-a"],
      },
      {
        topicId: "t4",
        sessionId: "s4",
        projectSlug: "p",
        conceptPath: ["subsystem", "module-a"],
      },
    ];
    const chain = buildChainCollapseOverlapHints(topicPaths);
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0].outerSegment).toBe("platformwrapper");
    expect(chain[0].innerSegment).toBe("subsystem");
  });

  it("derives scoped equivalences for sibling and node-alias hints", () => {
    const topicPaths: TopicConceptPathDecision[] = [
      {
        topicId: "t1",
        sessionId: "s1",
        projectSlug: "p",
        conceptPath: ["platform-alpha", "core", "a"],
      },
      {
        topicId: "t2",
        sessionId: "s2",
        projectSlug: "p",
        conceptPath: ["platform-alpha", "core", "b"],
      },
      {
        topicId: "t3",
        sessionId: "s3",
        projectSlug: "p",
        conceptPath: ["platform-beta", "core", "a"],
      },
      {
        topicId: "t4",
        sessionId: "s4",
        projectSlug: "p",
        conceptPath: ["platform-beta", "core", "b"],
      },
    ];
    const nodes: ConceptOntologyNode[] = [
      {
        key: "runtime",
        label: "Runtime",
        aliases: ["ART"],
        evidence: ["runtime subsystem"],
      },
      { key: "art", label: "ART", evidence: ["art module"] },
    ];
    const hints = buildAllSegmentOverlapHints(topicPaths, nodes);
    expect(hints.some((h) => h.kind === "sibling")).toBe(true);
    const equivs = deriveEquivalencesFromTopicPaths(topicPaths, nodes);
    expect(equivs.some((e) => e.aliases?.length)).toBe(true);
  });
});
