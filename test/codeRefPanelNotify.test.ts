import { describe, expect, it } from "vitest";
import {
  getProjectSessionIdsOnMap,
  resolveCodeRefPanelNotifyKind,
} from "../extension/src/codeRefQueue";
import type { MindMapRoot } from "../extension/src/transcript/types";

function mapWithSessions(projectSlug: string, sessionIds: string[]): MindMapRoot {
  return {
    data: {
      text: "root",
      origin: {
        refs: sessionIds.map((sessionId) => ({
          sessionId,
          projectSlug,
          sessionLabel: sessionId,
          transcriptPath: `/tmp/${sessionId}.jsonl`,
        })),
      },
    },
  };
}

describe("resolveCodeRefPanelNotifyKind", () => {
  it("returns single for one-session maps", () => {
    const map = mapWithSessions("proj", ["s1"]);
    expect(resolveCodeRefPanelNotifyKind(map, "proj", "s1")).toBe("single");
    expect(getProjectSessionIdsOnMap(map, "proj")).toEqual(new Set(["s1"]));
  });

  it("returns merged for multi-session project maps", () => {
    const map = mapWithSessions("proj", ["s1", "s2", "s3"]);
    expect(resolveCodeRefPanelNotifyKind(map, "proj", "s2")).toBe("merged");
  });

  it("returns none when the updated session is not on the current map", () => {
    const map = mapWithSessions("proj", ["s1", "s2"]);
    expect(resolveCodeRefPanelNotifyKind(map, "proj", "s9")).toBe("none");
  });
});
