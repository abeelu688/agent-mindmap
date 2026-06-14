import { describe, expect, it } from "vitest";
import { buildOutlineMindMap } from "../extension/src/mindmap/buildOutlineMindMap";
import type { CodeReference, SessionOutline } from "../extension/src/llm/types";

const sampleOutline: SessionOutline = {
  title: "Binder IPC",
  outline: [
    {
      title: "Android IPC",
      summary: "跨进程通信",
      children: [
        {
          title: "Binder",
          details: [
            { text: "tr.code 字段", sourceTurnIndices: [0] },
            { text: "BR_TRANSACTION", sourceTurnIndices: [1] },
          ],
        },
      ],
    },
  ],
};

const sessionMeta = {
  sessionId: "sess-1",
  projectSlug: "proj",
  sessionLabel: "label",
  transcriptPath: "/tmp/t.jsonl",
};

describe("buildOutlineMindMap", () => {
  it("uses outline.title as root", () => {
    const root = buildOutlineMindMap(sampleOutline, "ignored");
    expect(root.data.text).toBe("Binder IPC");
  });

  it("renders nested branches and detail leaves", () => {
    const root = buildOutlineMindMap(sampleOutline, "label");
    expect(root.children?.length).toBe(1);
    const ipc = root.children![0];
    expect(ipc.data.text).toBe("Android IPC");
    const binder = ipc.children?.find((c) => c.data.text === "Binder");
    expect(binder).toBeDefined();
    const leaves = binder!.children?.map((c) => c.data.text) ?? [];
    expect(leaves.some((t) => t.includes("tr.code") && t.includes("(Q1)"))).toBe(true);
  });

  it("attaches origin refs on detail leaves", () => {
    const root = buildOutlineMindMap(sampleOutline, "label", sessionMeta);
    const ipc = root.children![0];
    const binder = ipc.children?.find((c) => c.data.text === "Binder");
    const leaf = binder!.children?.find((c) => c.data.text.includes("tr.code"));
    expect(leaf?.data.origin?.refs?.[0].turnIndex).toBe(0);
  });

  it("localizes deterministic summary and code reference labels by output language", () => {
    const refs: CodeReference[] = [
      {
        path: "src/a.ts",
        lines: "-",
        description: "修复路由逻辑",
        sourceTurnIndices: [0],
      },
    ];
    const english = buildOutlineMindMap(sampleOutline, "label", sessionMeta, refs);
    expect(english.children?.[0].children?.[0].data.text).toMatch(/^Summary: /);
    expect(english.children?.at(-1)?.data.text).toBe("Related code");

    const chinese = buildOutlineMindMap(
      sampleOutline,
      "label",
      sessionMeta,
      refs,
      undefined,
      "Chinese"
    );
    expect(chinese.children?.[0].children?.[0].data.text).toMatch(/^概述：/);
    expect(chinese.children?.at(-1)?.data.text).toBe("相关代码");
  });
});
