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
    expect(__testing.classifyUserQueryLanguage("Como posso corrigir esse erro?")).toBe(
      "Portuguese"
    );
    expect(__testing.classifyUserQueryLanguage("¿Cómo puedo corregir este error?")).toBe("Spanish");
    expect(__testing.classifyUserQueryLanguage("Wie kann ich diesen Fehler beheben?")).toBe(
      "German"
    );
    expect(__testing.classifyUserQueryLanguage("Comment corriger cette erreur ?")).toBe("French");
    expect(__testing.classifyUserQueryLanguage("इस त्रुटि को कैसे ठीक करें?")).toBe("Hindi");
    expect(__testing.classifyUserQueryLanguage("Bagaimana cara memperbaiki error ini?")).toBe(
      "Indonesian"
    );
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

  it("detects Chinese question at the beginning before pasted logs", () => {
    const questionFirst = [
      "这个堆栈是什么意思？",
      "2026-06-14T12:00:00.000Z ERROR com.example.Service failed",
      "at com.example.Service.handle(Service.java:123:45)",
      "at com.example.Controller.route(Controller.java:88:21)",
      '{"level":"error","message":"request failed","path":"/api/internal/users/1234567890"}',
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(questionFirst)).toBe("Chinese");
  });

  it("ignores large homogeneous log blocks and scores boundary context", () => {
    const logLines = Array.from(
      { length: 50 },
      (_, index) =>
        `2026-06-14T12:00:${String(index).padStart(2, "0")}.000Z ERROR com.example.Service failed id=${index}`
    );
    const logBlockQuestion = [...logLines, "请看一下上面日志，问题出在哪？"].join("\n");

    expect(__testing.findPayloadBlocks(logLines).length).toBeGreaterThan(0);
    expect(__testing.classifyUserQueryLanguage(logBlockQuestion)).toBe("Chinese");
  });

  it("prefers Chinese when mixed with many English identifiers", () => {
    const mixed = [
      "getUserById",
      "ServiceController",
      "handleRequest",
      "ERROR_CODE_INTERNAL",
      "com.example.api.UserService",
      "这个 getUserById 报错怎么修？",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(mixed)).toBe("Chinese");
  });

  it("classifies mixed Chinese instruction with English technical terms as Chinese", () => {
    expect(__testing.classifyUserQueryLanguage("帮我把这个 module refactor 一下，可以吗？")).toBe(
      "Chinese"
    );
  });

  it("strips fenced code blocks and keeps surrounding natural language", () => {
    const withFence = [
      "这是外层问题",
      '```json\n{"a":1,"b":2,"nested":{"c":3}}\n```',
      "请帮忙看看",
    ].join("\n");

    expect(__testing.preprocessQueryText(withFence)).not.toContain('"a":1');
    expect(__testing.classifyUserQueryLanguage(withFence)).toBe("Chinese");
  });

  it("skips pure digit and symbol lines during scoring", () => {
    expect(__testing.extractLettersOnly("1234567890")).toBe("");
    expect(__testing.isLikelyPayloadLine("1234567890")).toBe(true);
    expect(__testing.classifyUserQueryLanguage("1234567890\n这个怎么修？")).toBe("Chinese");
  });

  it("breaks session ties toward the latest clear question", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "How does this work?", lineIndex: 0 },
      { kind: "user_query", text: "这个实现哪里有问题？", lineIndex: 1 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Chinese");
  });

  it("weights later user queries more heavily in session voting", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: "How does this work?", lineIndex: 0 },
      { kind: "user_query", text: "What about edge cases?", lineIndex: 1 },
      { kind: "user_query", text: "这个实现哪里有问题？", lineIndex: 2 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Chinese");
  });

  it("falls back to English when no clear user language exists", () => {
    const events: ChatEvent[] = [
      { kind: "user_query", text: '```json\n{"a":1,"b":2}\n```', lineIndex: 0 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("English");
  });

  it("treats camelCase identifiers as low-weight English signals", () => {
    expect(__testing.isLatinIdentifier("getUserById")).toBe(true);
    expect(__testing.isLatinIdentifier("Service")).toBe(false);
    expect(__testing.isLatinIdentifier("how")).toBe(false);
  });

  it("boosts intent-like question lines", () => {
    expect(__testing.isIntentLine("上面这个错误应该怎么修？")).toBe(true);
    expect(__testing.isIntentLine("How do I fix this error?")).toBe(true);
  });

  it("ignores agent plan-implement template lines", () => {
    const template =
      "Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.";
    expect(__testing.isAgentInstructionLine(template)).toBe(true);
    expect(__testing.isNaturalEnglishLine(template)).toBe(true);
  });

  it("classifies Chinese plan title despite attached implement-plan template", () => {
    const q2 = [
      "Golang 加密 HTTP 通信 SDK 实现计划",
      "Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.",
      "To-do's from the plan have already been created. Do NOT create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(q2)).toBe("Chinese");
  });

  it("detects Chinese SDK session despite plan-implement template in Q2", () => {
    const q1 =
      "给我实现一个加密通信的golang sdk，使用场景是，在http请求的基础上，要有类似https通信的会话加密效果";
    const q2 = [
      "Golang 加密 HTTP 通信 SDK 实现计划",
      "Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.",
      "To-do's from the plan have already been created. Do NOT create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.",
    ].join("\n");
    const events: ChatEvent[] = [
      { kind: "user_query", text: q1, lineIndex: 0 },
      { kind: "user_query", text: q2, lineIndex: 1 },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Chinese");
  });

  it("still detects English when only plan-implement template is present", () => {
    const templateOnly = [
      "Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.",
      "To-do's from the plan have already been created. Do NOT create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(templateOnly)).toBeUndefined();
    const events: ChatEvent[] = [{ kind: "user_query", text: templateOnly, lineIndex: 0 }];
    expect(resolveOutputLanguageForEvents(events)).toBe("English");
  });

  it("keeps English for handwritten English requests with a Chinese-looking title prefix", () => {
    const mixedHandwritten = [
      "支付 API 设计",
      "Please implement a REST API for payments with idempotency keys and webhook retries.",
      "How should we structure the error responses?",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(mixedHandwritten)).toBe("English");
  });

  it("detects Portuguese with English technical terms in session voting", () => {
    const events: ChatEvent[] = [
      {
        kind: "user_query",
        text: "Como posso corrigir esse erro no getUserById handler?",
        lineIndex: 0,
      },
      {
        kind: "user_query",
        text: "Também revise o retry middleware e explique por que falha.",
        lineIndex: 1,
      },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Portuguese");
  });

  it("detects Spanish with English technical terms in session voting", () => {
    const events: ChatEvent[] = [
      {
        kind: "user_query",
        text: "¿Cómo puedo corregir este error en el auth middleware?",
        lineIndex: 0,
      },
      {
        kind: "user_query",
        text: "Ayuda a revisar por qué falla el webhook retry.",
        lineIndex: 1,
      },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Spanish");
  });

  it("detects German with English technical terms in session voting", () => {
    const events: ChatEvent[] = [
      {
        kind: "user_query",
        text: "Wie kann ich diesen Fehler im cache refresh beheben?",
        lineIndex: 0,
      },
      {
        kind: "user_query",
        text: "Bitte prüfe warum der build step nicht funktioniert.",
        lineIndex: 1,
      },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("German");
  });

  it("detects French with English technical terms in session voting", () => {
    const events: ChatEvent[] = [
      {
        kind: "user_query",
        text: "Comment corriger cette erreur dans le payment controller ?",
        lineIndex: 0,
      },
      {
        kind: "user_query",
        text: "Peut-on aussi vérifier pourquoi le webhook retry échoue ?",
        lineIndex: 1,
      },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("French");
  });

  it("detects Hindi around pasted English logs", () => {
    const logHeavyQuestion = [
      "2026-06-14T12:00:00.000Z ERROR com.example.Service failed",
      "at com.example.Service.handle(Service.java:123:45)",
      "ऊपर वाली त्रुटि को कैसे ठीक करें?",
    ].join("\n");

    expect(__testing.classifyUserQueryLanguage(logHeavyQuestion)).toBe("Hindi");
  });

  it("detects Indonesian with English technical terms in session voting", () => {
    const events: ChatEvent[] = [
      {
        kind: "user_query",
        text: "Bagaimana cara memperbaiki error ini di session loader?",
        lineIndex: 0,
      },
      {
        kind: "user_query",
        text: "Tolong jelaskan kenapa cache refresh tidak berjalan.",
        lineIndex: 1,
      },
    ];

    expect(resolveOutputLanguageForEvents(events)).toBe("Indonesian");
  });
});
