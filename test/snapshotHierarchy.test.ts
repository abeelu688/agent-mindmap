import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  createEmptySnapshotManifest,
  findLeafNodeForSession,
  findParentNode,
  snapshotVirtualSessionId,
  writeSnapshotManifest,
  readSnapshotManifest,
} from "../extension/src/store/mergeSnapshot";
import type { SnapshotManifest, SnapshotNode } from "../extension/src/store/storeTypes";

function leafNode(id: string, sessionIds: string[]): SnapshotNode {
  return {
    id,
    level: 1,
    childIds: [],
    sessionIds,
    builtAt: 1,
    path: `snapshots/${id}.json`,
  };
}

function groupNode(
  id: string,
  level: number,
  childIds: string[],
  sessionIds: string[]
): SnapshotNode {
  return {
    id,
    level,
    childIds,
    sessionIds,
    builtAt: 1,
    path: `snapshots/${id}.json`,
  };
}

describe("snapshot hierarchy manifest", () => {
  let storeDir: string;
  const projectSlug = "proj-a";

  beforeEach(async () => {
    storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "am-snap-"));
  });

  afterEach(async () => {
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it("creates and reads empty manifest", async () => {
    const manifest = createEmptySnapshotManifest(projectSlug, 5);
    await writeSnapshotManifest(storeDir, manifest);
    const read = await readSnapshotManifest(storeDir, projectSlug);
    expect(read?.schemaVersion).toBe(2);
    expect(read?.groupSize).toBe(5);
    expect(read?.topLevelIds).toEqual([]);
  });

  it("finds leaf and parent nodes", () => {
    const manifest: SnapshotManifest = {
      schemaVersion: 2,
      projectSlug,
      groupSize: 5,
      nodes: [
        leafNode("l1-0001", ["s1", "s2"]),
        groupNode("l2-0001", 2, ["l1-0001", "l1-0002"], ["s1", "s2", "s3"]),
        leafNode("l1-0002", ["s3"]),
      ],
      topLevelIds: ["l2-0001", "l1-0003"],
      sessionToLeafId: { s1: "l1-0001", s2: "l1-0001", s3: "l1-0002" },
    };

    expect(findLeafNodeForSession(manifest, "s2")?.id).toBe("l1-0001");
    expect(findParentNode(manifest, "l1-0001")?.id).toBe("l2-0001");
    expect(findParentNode(manifest, "l1-0003")).toBeUndefined();
  });

  it("builds virtual session ids for snapshot nodes", () => {
    expect(snapshotVirtualSessionId("l1-0001")).toBe("__snapshot_l1-0001__");
  });
});

describe("top-level grouping scenarios", () => {
  it("7 L1 leaves produce topLevel [l2-0001, l1-0006, l1-0007]", () => {
    const nodes: SnapshotNode[] = [];
    const topLevelIds: string[] = [];
    for (let i = 1; i <= 7; i += 1) {
      const id = `l1-${String(i).padStart(4, "0")}`;
      nodes.push(leafNode(id, [`s${i}`]));
      topLevelIds.push(id);
    }
    const group = topLevelIds.slice(0, 5);
    const l2 = groupNode(
      "l2-0001",
      2,
      group,
      group.flatMap((id) => nodes.find((n) => n.id === id)!.sessionIds)
    );
    nodes.push(l2);
    const nextTop = ["l2-0001", "l1-0006", "l1-0007"];
    expect(nextTop).toHaveLength(3);
    expect(nextTop[0]).toBe("l2-0001");
  });
});
