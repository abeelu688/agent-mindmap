import { describe, it, expect } from "vitest";
import {
  buildVirtualSessionAnalysisPrompt,
  VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION,
  type VirtualSessionContextPrimer,
} from "../core/src/llm/promptAnalyzeVirtualSession";
import type { ChatEvent } from "../core/src/transcript/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function userQuery(text: string, lineIndex = 0): ChatEvent {
  return { kind: "user_query", text, lineIndex };
}
function toolCall(name: string, label: string, lineIndex = 0): ChatEvent {
  return { kind: "tool", name, label, lineIndex, filePaths: [] };
}
function assistantSummary(text: string, lineIndex = 0): ChatEvent {
  return { kind: "assistant_summary", text, preview: text.slice(0, 50), lineIndex };
}

function buildSession(turnCount: number): ChatEvent[] {
  const events: ChatEvent[] = [];
  let lineIndex = 0;
  for (let i = 0; i < turnCount; i++) {
    events.push(userQuery(`Query ${i + 1}`, lineIndex++));
    events.push(toolCall(`tool_${i}`, `Tool ${i}`, lineIndex++));
    events.push(assistantSummary(`Summary ${i + 1}`, lineIndex++));
  }
  return events;
}

const basePrimer: VirtualSessionContextPrimer = {
  originalSessionLabel: "Original Session",
  virtualSessionIndex: 1,
  priorTopics: [],
  priorCodeRefs: [],
};

const baseOpts = {
  maxDomains: 6,
  maxNodes: 12,
  maxBranches: 6,
  maxDetailsPerNode: 6,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildVirtualSessionAnalysisPrompt", () => {
  it("exports a prompt version", () => {
    expect(VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("includes the JSON-only instruction at the top", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, basePrimer);
    expect(prompt.startsWith("IMPORTANT: You MUST respond with valid JSON only")).toBe(true);
  });

  it("mentions the virtual session index and original session label", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, {
      ...basePrimer,
      virtualSessionIndex: 3,
      originalSessionLabel: "My Session",
    });
    expect(prompt).toContain('virtual session #3 of "My Session"');
  });

  it("includes prior topics with their concept paths", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, {
      ...basePrimer,
      priorTopics: [
        { title: "React Hooks", conceptPath: ["frontend", "react", "hooks"] },
        { title: "State Management" },
      ],
    });
    expect(prompt).toContain("1. React Hooks [frontend/react/hooks]");
    expect(prompt).toContain("2. State Management");
  });

  it("shows (none) for prior topics on first virtual session", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, {
      ...basePrimer,
      priorTopics: [],
    });
    expect(prompt).toContain("(none - this is the first virtual session)");
  });

  it("includes prior code refs with path and description", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, {
      ...basePrimer,
      priorCodeRefs: [
        { path: "/proj/foo.ts", description: "foo module" },
        { path: "/proj/bar.ts", description: "bar module" },
      ],
    });
    expect(prompt).toContain("1. /proj/foo.ts - foo module");
    expect(prompt).toContain("2. /proj/bar.ts - bar module");
  });

  it("includes the concept continuity rule", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, basePrimer);
    expect(prompt).toContain("Concept continuity rule");
    expect(prompt).toContain("reuse conceptPath segments");
  });

  it("includes the transcript body at the end", () => {
    const events = buildSession(2);
    const prompt = buildVirtualSessionAnalysisPrompt(events, baseOpts, basePrimer);
    // The body should contain the user queries
    expect(prompt).toContain("Query 1");
    expect(prompt).toContain("Query 2");
    // Body is appended after the === separator
    expect(prompt).toContain("===");
    const bodyStart = prompt.indexOf("===");
    const body = prompt.slice(bodyStart);
    expect(body).toContain("Query 1");
  });

  it("uses Cursor Agent label for cursor host", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(
      buildSession(1),
      baseOpts,
      basePrimer,
      "cursor"
    );
    expect(prompt).toContain("Cursor Agent");
  });

  it("uses Claude Code Agent label for claude-code host", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(
      buildSession(1),
      baseOpts,
      basePrimer,
      "claude-code"
    );
    expect(prompt).toContain("Claude Code Agent");
  });

  it("writes user-visible fields in the specified output language", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(
      buildSession(1),
      baseOpts,
      basePrimer,
      "cursor",
      undefined,
      "Chinese"
    );
    expect(prompt).toContain("Write all user-visible natural-language output fields in Chinese");
  });

  it("instructs the LLM to analyze ONLY the new turns", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, basePrimer);
    expect(prompt).toContain("Analyze ONLY the new turns shown below");
    expect(prompt).toContain("do not re-analyze prior turns");
  });

  it("includes sourceTurnIndices guidance relative to new turns", () => {
    const prompt = buildVirtualSessionAnalysisPrompt(buildSession(1), baseOpts, basePrimer);
    expect(prompt).toContain("[Q1]->0, [Q2]->1");
  });
});
