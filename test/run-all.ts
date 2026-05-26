import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTurnMindMap } from "../extension/src/mindmap/buildMindMapData";
import { buildTopicMindMap } from "../extension/src/mindmap/buildTopicMindMap";
import { validateTopicGraph } from "../extension/src/llm/cursorCliProvider";
import { summarizeSession } from "../extension/src/llm/summarizeSession";
import { LlmProviderError } from "../extension/src/llm/types";
import type {
  LlmProvider,
  SummarizeInput,
  TopicGraph,
} from "../extension/src/llm/types";
import { extractUserQuery, parseJsonl } from "../extension/src/transcript/parseJsonl";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

async function main(): Promise<void> {
  const fixture = readFileSync(
    join(__dirname, "../../test/fixtures/sample.jsonl"),
    "utf8"
  );

  // parseJsonl
  assert(
    extractUserQuery("<user_query>\nHello\n</user_query>") === "Hello",
    "extractUserQuery"
  );

  const events = parseJsonl(fixture);
  assert(events.some((e) => e.kind === "user_query"), "has user_query");
  assert(events.some((e) => e.kind === "tool"), "has tool");
  assert(events.some((e) => e.kind === "assistant_summary"), "has summary");

  // turn fallback
  const turnRoot = buildTurnMindMap(events, {
    includeToolCalls: true,
    maxConclusionItems: 8,
  });
  assert((turnRoot.children?.length ?? 0) > 0, "turn: has children");
  const q1 = turnRoot.children?.[0];
  assert(q1?.data.text.startsWith("Q1:") ?? false, "turn: Q1 label");
  const turnSubs = q1?.children?.map((c) => c.data.text) ?? [];
  assert(turnSubs.includes("调研"), "turn: has research branch");
  assert(turnSubs.includes("结论"), "turn: has conclusion branch");

  const turnNoTools = buildTurnMindMap(events, {
    includeToolCalls: false,
    maxConclusionItems: 8,
  });
  const turnSubs2 =
    turnNoTools.children?.[0]?.children?.map((c) => c.data.text) ?? [];
  assert(!turnSubs2.includes("调研"), "turn: no research when disabled");

  // topic graph validation
  const validGraph = validateTopicGraph({
    topics: [{ title: "Binder", items: [{ text: "tr.code" }] }],
  });
  assert(validGraph.topics.length === 1, "validate: keeps valid topic");

  let threwOnEmptyTopics = false;
  try {
    validateTopicGraph({ topics: [] });
  } catch (e) {
    threwOnEmptyTopics = e instanceof LlmProviderError;
  }
  assert(threwOnEmptyTopics, "validate: rejects empty topics");

  // topic mind map
  const topicRoot = buildTopicMindMap(validGraph, "session-label");
  assert(topicRoot.data.text === "session-label", "topic: root label");
  assert(
    topicRoot.children?.[0]?.data.text.startsWith("核心1:") ?? false,
    "topic: 核心1 prefix"
  );

  // summarizeSession happy + cache
  let cacheCalls = 0;
  const fakeProvider: LlmProvider = {
    id: "fake",
    async summarize(_input: SummarizeInput): Promise<TopicGraph> {
      cacheCalls += 1;
      return validGraph;
    },
  };

  const cacheDir = mkdtempSync(join(tmpdir(), "agent-mindmap-runall-"));
  try {
    const opts = {
      prompt: { maxTopics: 6, maxItemsPerTopic: 6 },
      cacheDir,
      cache: true,
    };
    await summarizeSession(events, opts, fakeProvider, new AbortController().signal);
    assert(cacheCalls === 1, "summarize: first call hits provider");
    await summarizeSession(events, opts, fakeProvider, new AbortController().signal);
    assert(cacheCalls === 1, "summarize: second call hits cache");
  } finally {
    try {
      rmSync(cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log("All tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
