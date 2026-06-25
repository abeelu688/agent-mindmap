import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, afterEach } from "vitest";
import { listFlatJsonlSessions } from "@agent-mindmap/core";

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

  it("skips headless SDK-CLI sessions (entrypoint=sdk-cli)", async () => {
    dir = mkdtempSync(join(tmpdir(), "claude-sessions-"));
    // Real user session (entrypoint=cli)
    writeFileSync(
      join(dir, "real-session.jsonl"),
      JSON.stringify({
        type: "user",
        entrypoint: "cli",
        promptSource: "typed",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      }) + "\n",
      "utf8"
    );
    // Headless SDK session (entrypoint=sdk-cli) — should be skipped
    writeFileSync(
      join(dir, "sdk-session.jsonl"),
      JSON.stringify({
        type: "user",
        entrypoint: "sdk-cli",
        promptSource: "sdk",
        message: {
          role: "user",
          content: [{ type: "text", text: "You are a session synthesis assistant…" }],
        },
      }) + "\n",
      "utf8"
    );

    const sessions = await listFlatJsonlSessions(dir, {
      hostId: "claude-code",
      projectSlug: "-test-proj",
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].id).toBe("real-session");
  });
});
