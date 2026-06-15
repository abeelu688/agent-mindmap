import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { computeBatchMergeCacheKey } from "../extension/src/pipeline/mergePipeline";
import { ontologyCachePath } from "../extension/src/store/sessionStore";
import { writeJsonAtomic } from "../extension/src/store/atomicWrite";

describe("computeBatchMergeCacheKey", () => {
  it("produces Windows-safe filenames (no colon separators)", () => {
    const key = computeBatchMergeCacheKey([], {
      providerId: "cursor-cli",
      hostId: "cursor",
    });
    expect(key).not.toMatch(/[<>:"/\\|?*]/);
    expect(key).not.toContain(":");
    for (const ch of key) {
      expect(ch.charCodeAt(0)).toBeGreaterThan(31);
    }
  });

  it("can be written atomically on Windows-style paths", async () => {
    const key = computeBatchMergeCacheKey([], {
      providerId: "cursor-cli",
      hostId: "cursor",
    });
    const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-mindmap-cache-key-"));
    const filePath = ontologyCachePath(storeDir, key);
    await writeJsonAtomic(filePath, { ok: true });
    const raw = await fs.readFile(filePath, "utf8");
    expect(JSON.parse(raw)).toEqual({ ok: true });
  });
});
