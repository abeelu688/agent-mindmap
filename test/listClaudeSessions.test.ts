import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, afterEach } from "vitest";
import { listFlatJsonlSessions } from "../extension/src/transcript/listSessions";

describe("listFlatJsonlSessions", () => {
  let dir: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists top-level jsonl and skips subagent dirs", async () => {
    dir = mkdtempSync(join(tmpdir(), "claude-sessions-"));
    writeFileSync(
      join(dir, "abc-123.jsonl"),
      '{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}\n',
      "utf8"
    );
    mkdirSync(join(dir, "subagents"));
    writeFileSync(
      join(dir, "subagents", "agent-1.jsonl"),
      '{"role":"user","message":{"content":[{"type":"text","text":"side"}]}}\n',
      "utf8"
    );

    const sessions = await listFlatJsonlSessions(dir, {
      hostId: "claude-code",
      projectSlug: "-test-proj",
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("abc-123");
    expect(sessions[0].hostId).toBe("claude-code");
  });
});
