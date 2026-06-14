import { describe, expect, it } from "vitest";
import { __testing, resolveOutputLanguageForEvents } from "../extension/src/llm/promptLanguage";
import type { ChatEvent } from "../extension/src/transcript/types";

describe("output language detection", () => {
  it("classifies individual user queries by dominant natural language", () => {
    expect(__testing.classifyUserQueryLanguage("这个报错怎么修？")).toBe("Chinese");
    expect(__testing.classifyUserQueryLanguage("How do I fix this error?")).toBe("English");
    expect(__testing.classifyUserQueryLanguage("このエラーをどう直せばいいですか？")).toBe(
      "Japanese"
    );
    expect(__testing.classifyUserQueryLanguage("이 오류를 어떻게 고치나요?")).toBe("Korean");
  });

  it("uses user_query votes and ignores assistant/tool text", () => {
    const events: ChatEvent[] = [
      { kind: "assistant_summary", text: "大量中文总结", preview: "大量中文总结", lineIndex: 0 },
      { kind: "tool", name: "shell", label: "大量中文日志", lineIndex: 1 },
      { kind: "user_query", text: "How should we refactor this?", lineIndex: 2 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("English");
  });

  it("lets the actual question beat pasted logs inside one query", () => {
    const logHeavyQuestion = [
      "2026-06-14T12:00:00.000Z ERROR com.example.Service failed",
      "at com.example.Service.handle(Service.java:123:45)",
      "at com.example.Controller.route(Controller.java:88:21)",
      '{"level":"error","message":"request failed","path":"/api/internal/users/1234567890"}',
      "上面这个错误应该怎么修？",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(logHeavyQuestion)).toBe("Chinese");
  });

  it("breaks session ties toward the latest clear question", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "How does this work?", lineIndex: 0 },
      { kind: "user_query", text: "这个实现哪里有问题？", lineIndex: 1 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Chinese");
  });

  it("falls back to English when no clear user language exists", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: '```json\n{"a":1,"b":2}\n```', lineIndex: 0 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("English");
  });
});
