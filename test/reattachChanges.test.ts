import { describe, expect, it } from "vitest";
import {
  parseReattachChangesList,
  reattachChangesToSteps,
  tryParseReattachChangesResponse,
} from "../extension/src/llm/reattachChanges";

describe("reattachChanges", () => {
  it("parses attach and merge changes", () => {
    const changes = parseReattachChangesList([
      { kind: "attach", hub: "androidplatform", node: "aosp" },
      { kind: "merge", keep: "androidlogging", remove: "debugging" },
    ]);
    expect(changes).toHaveLength(2);
    const steps = reattachChangesToSteps(changes);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      kind: "attach_under",
      sourceFrom: "aosp",
      targetPath: ["androidplatform", "aosp"],
    });
    expect(steps[0]!.sourceNodeId).toBeUndefined();
    expect(steps[1]).toMatchObject({
      kind: "merge_synonym",
      sourceFrom: "debugging",
      targetPath: ["androidlogging"],
    });
  });

  it("tryParseReattachChangesResponse reads changes wrapper", () => {
    const steps = tryParseReattachChangesResponse({
      changes: [{ kind: "attach", hub: "forest", node: "mozillagecko" }],
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]!.action).toContain("forest->mozillagecko");
  });
});
