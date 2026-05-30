import { describe, expect, it } from "vitest";
import {
  applyOrphanRootReparent,
  buildOrphanRootReparentRules,
  rulesToReparentMap,
} from "../extension/src/llm/reparentOrphanRootPaths";
import type { TopicConceptPathDecision } from "../extension/src/store/ontologyTypes";
import type { ConceptOntologyNode } from "../extension/src/llm/types";

function paths(...conceptPaths: string[][]): TopicConceptPathDecision[] {
  return conceptPaths.map((conceptPath, i) => ({
    topicId: `t${i}`,
    sessionId: `s${i}`,
    projectSlug: "proj",
    conceptPath,
  }));
}

describe("reparentOrphanRootPaths", () => {
  it("reparents orphan root subsystem paths under platform-alpha", () => {
    const topicPaths = paths(
      ["subsystem", "routing", "handlers"],
      ["subsystem", "routing", "middleware"],
      ["platform-alpha", "subsystem", "routing", "handlers"],
      ["platform-alpha", "subsystem", "routing", "middleware"],
      ["platform-alpha", "subsystem", "config"]
    );
    const rules = buildOrphanRootReparentRules(topicPaths);
    expect(rules.length).toBeGreaterThan(0);
    const subsystemRule = rules.find((r) => r.segmentKey === "subsystem");
    expect(subsystemRule?.parentKey).toBe("platformalpha");

    const map = rulesToReparentMap(rules);
    expect(
      applyOrphanRootReparent(
        ["subsystem", "routing", "handlers"],
        map
      )
    ).toEqual(["platform-alpha", "subsystem", "routing", "handlers"]);
  });

  it("uses ontology parentKeys to pick parent when counts tie", () => {
    const topicPaths = paths(
      ["core", "module-a"],
      ["core", "module-b"],
      ["platform-a", "core", "module-a"],
      ["platform-b", "core", "module-b"]
    );
    const nodes: ConceptOntologyNode[] = [
      {
        key: "core",
        label: "Core",
        parentKeys: ["platform-a"],
        evidence: ["core module"],
      },
    ];
    const rules = buildOrphanRootReparentRules(topicPaths, nodes, {
      minNestedPaths: 1,
    });
    const coreRule = rules.find((r) => r.segmentKey === "core");
    expect(coreRule?.parentKey).toBe("platforma");
  });
});
