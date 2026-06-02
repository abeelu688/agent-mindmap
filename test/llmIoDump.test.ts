import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  dumpDirForWorkspace,
  LLM_DUMP_FOLDER,
  dumpLlmReplay,
  writeLlmIoDump,
  __testing,
} from "../extension/src/llm/llmIoDump";

describe("llmIoDump", () => {
  it("dumpDirForWorkspace joins workspace root and folder name", () => {
    expect(dumpDirForWorkspace("/home/proj")).toBe(
      `/home/proj/${LLM_DUMP_FOLDER}`
    );
  });

  it("writeLlmIoDump writes expected files under stage subfolder", async () => {
    const root = mkdtempSync(join(tmpdir(), "llm-dump-test-"));
    const out = await writeLlmIoDump({
      stageId: "session-analysis",
      responseSchema: "session-analysis",
      providerId: "cursor-cli",
      model: "test-model",
      prompt: "PROMPT_BODY",
      stdout: '{"domains":[]}',
      stderr: "warn line",
      parsed: { domains: [], nodes: [] },
      attempt: 1,
      maxAttempts: 3,
      durationMs: 42,
      sessionId: "sess-1",
      projectSlug: "proj-slug",
      dumpRoot: root,
    });

    expect(out).toBeTruthy();
    const stageDir = join(root, "session-analysis");
    const entries = readdirSync(stageDir);
    expect(entries.length).toBe(1);
    const runDir = join(stageDir, entries[0]!);
    expect(existsSync(join(runDir, "prompt.txt"))).toBe(true);
    expect(readFileSync(join(runDir, "prompt.txt"), "utf8")).toBe("PROMPT_BODY");
    expect(readFileSync(join(runDir, "stdout.txt"), "utf8")).toBe('{"domains":[]}');
    expect(readFileSync(join(runDir, "stderr.txt"), "utf8")).toBe("warn line");
    const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as {
      stageId: string;
      ok: boolean;
      sessionId: string;
    };
    expect(meta.stageId).toBe("session-analysis");
    expect(meta.ok).toBe(true);
    expect(meta.sessionId).toBe("sess-1");
    expect(
      JSON.parse(readFileSync(join(runDir, "parsed.json"), "utf8"))
    ).toEqual({ domains: [], nodes: [] });
  });

  it("writeLlmIoDump writes error.json on failure", async () => {
    const root = mkdtempSync(join(tmpdir(), "llm-dump-err-"));
    await writeLlmIoDump({
      stageId: "reattach-moves",
      responseSchema: "reattach-moves",
      providerId: "cursor-cli",
      prompt: "x",
      stdout: "not json",
      error: { code: "bad-json", message: "parse failed" },
      attempt: 2,
      maxAttempts: 3,
      durationMs: 100,
      dumpRoot: root,
    });
    const stageDir = join(root, "reattach-moves");
    const runDir = join(stageDir, readdirSync(stageDir)[0]!);
    const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as {
      ok: boolean;
    };
    expect(meta.ok).toBe(false);
    const err = JSON.parse(readFileSync(join(runDir, "error.json"), "utf8")) as {
      code: string;
    };
    expect(err.code).toBe("bad-json");
  });

  it("dumpLlmReplay sets source in meta.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "llm-dump-replay-"));
    await dumpLlmReplay({
      stageId: "session-analysis",
      responseSchema: "session-analysis",
      providerId: "cursor-cli",
      prompt: "cached prompt",
      parsed: { ok: true },
      source: "library-cache",
      sessionId: "s1",
      dumpRoot: root,
    });
    const runDir = join(
      root,
      "session-analysis",
      readdirSync(join(root, "session-analysis"))[0]!
    );
    const meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")) as {
      source: string;
      attempt: number;
    };
    expect(meta.source).toBe("library-cache");
    expect(meta.attempt).toBe(0);
  });

  it("compactTimestamp is filesystem-safe", () => {
    const ts = __testing.compactTimestamp(new Date("2026-06-02T14:30:52.123Z"));
    expect(ts).not.toMatch(/[:.]/);
    expect(ts.endsWith("Z")).toBe(true);
  });
});
