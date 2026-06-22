import { describe, expect, it } from "vitest";
import { createBatchItemProgress } from "../extension/src/progress";

describe("createBatchItemProgress", () => {
  it("prefixes sub-step messages with batch position", () => {
    const messages: string[] = [];
    const { progress, reportComplete } = createBatchItemProgress(
      { report: (u) => messages.push(typeof u === "string" ? u : (u.message ?? "")) },
      2,
      5,
      "Binder IPC 调研"
    );
    progress.report("正在生成大纲…");
    reportComplete("分析完成");
    // In tests we use a vscode stub; l10n may be unavailable, so the prefix
    // falls back to locale heuristics. Assert the stable structure instead
    // of a single hard-coded language.
    expect(messages[0]).toContain("Binder IPC 调研");
    expect(messages[0]).toMatch(/\b3\/5\b/);
    expect(messages[1]).toMatch(/\b3\/5\b/);
  });
});
