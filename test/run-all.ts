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
import {
  buildRecordMeta,
  buildSessionRecord,
  isRecordFresh,
  listRecords,
  rebuildIndex,
  readRecord,
  sha256Hex,
  writeRecord,
} from "../extension/src/store/sessionStore";
import {
  buildDeterministicMergeMindMap,
  buildDeterministicMergeRecord,
} from "../extension/src/store/mergeDeterministic";
import { buildConceptTrieMindMap } from "../extension/src/store/mergeConceptTrie";
import { computeMergeCacheKey } from "../extension/src/store/mergeLlm";
import type { SessionRecord } from "../extension/src/store/storeTypes";
import {
  flattenCandidates,
  formatPickerLabel,
} from "../extension/src/jumpToOriginCore";
import type { NodeOriginRef } from "../extension/src/transcript/types";
import type { SessionMeta } from "../extension/src/mindmap/origin";

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
  // Back-compat: no sessionMeta => no origin metadata.
  assert(
    topicRoot.data.origin === undefined,
    "topic: no origin when sessionMeta omitted"
  );

  // origin bubbling through buildTopicMindMap
  const originGraph: TopicGraph = {
    title: "Binder 调研",
    topics: [
      {
        title: "tr.code",
        items: [
          { text: "tr.code 不在 Parcel 里", sourceTurnIndices: [0] },
          { text: "BR_TRANSACTION 路径", sourceTurnIndices: [2] },
        ],
      },
      {
        title: "调研工具",
        items: [{ text: "Grep binder_transaction", sourceTurnIndices: [0, 1] }],
      },
    ],
  };
  const originSessionMeta: SessionMeta = {
    sessionId: "sess-X",
    projectSlug: "proj-a",
    projectPath: "/work/proj-a",
    sessionLabel: "sess-X · now",
    transcriptPath: "/tmp/sess-X.jsonl",
  };
  const originRoot = buildTopicMindMap(
    originGraph,
    "label",
    originSessionMeta
  );
  const topic0Leaf = originRoot.children?.[0]?.children?.find((c) =>
    c.data.text.includes("tr.code 不在 Parcel")
  );
  assert(
    topic0Leaf?.data.origin?.refs.length === 1 &&
      topic0Leaf!.data.origin!.refs[0].turnIndex === 0,
    "origin: leaf refs single turnIndex"
  );
  const rootTurns = (originRoot.data.origin?.refs ?? [])
    .map((r) => r.turnIndex)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);
  assert(
    JSON.stringify(rootTurns) === JSON.stringify([0, 1, 2]),
    "origin: root unions all turn indices"
  );

  // flattenCandidates + formatPickerLabel
  const sessARef: Omit<NodeOriginRef, "turnIndex"> = {
    sessionId: "A",
    projectSlug: "p-a",
    sessionLabel: "A",
    transcriptPath: "/tmp/A.jsonl",
  };
  const sessBRef: Omit<NodeOriginRef, "turnIndex"> = {
    sessionId: "B",
    projectSlug: "p-b",
    sessionLabel: "B",
    transcriptPath: "/tmp/B.jsonl",
  };
  const flat = flattenCandidates([
    { ...sessARef, turnIndex: 0 },
    { ...sessARef, turnIndex: 0 },
    { ...sessARef, turnIndex: 1 },
    { ...sessBRef, turnIndex: 0 },
    { ...sessBRef },
  ]);
  assert(flat.length === 4, "flatten: dedups identical pairs");
  assert(
    flat[0].sessionId === "A" && flat[0].turnIndex === 0,
    "flatten: order preserved"
  );
  assert(
    flat[3].sessionId === "B" && flat[3].turnIndex === undefined,
    "flatten: branch row distinct from leaf"
  );
  assert(
    formatPickerLabel({ ...sessARef, turnIndex: undefined }) === "整段会话",
    "pickerLabel: branch label"
  );
  assert(
    formatPickerLabel({
      ...sessARef,
      turnIndex: 2,
      question: "Why does binder fail under load?",
    }) === "Q3: Why does binder fail under load?",
    "pickerLabel: turn label"
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

  // sessionStore + merge
  const storeDir = mkdtempSync(join(tmpdir(), "agent-mindmap-store-"));
  try {
    const baseMeta = (overrides: Partial<SessionRecord["meta"]> = {}) =>
      buildRecordMeta({
        sessionId: "sess-1",
        projectSlug: "proj-a",
        projectPath: "/work/proj-a",
        transcriptPath: "/tmp/sess-1.jsonl",
        transcriptMtimeMs: 1,
        transcriptSha256: sha256Hex("payload"),
        llm: { provider: "fake", model: "" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        sessionLabel: "sess-1 · now",
        ...overrides,
      });
    const recordA = buildSessionRecord(baseMeta(), validGraph);
    const recordB = buildSessionRecord(
      baseMeta({
        sessionId: "sess-2",
        projectSlug: "proj-b",
        projectPath: "/work/proj-b",
        sessionLabel: "sess-2 · now",
        analyzedAt: Date.now() + 1,
      }),
      validGraph
    );
    await writeRecord(storeDir, recordA);
    await writeRecord(storeDir, recordB);

    const loaded = await readRecord(storeDir, "proj-a", "sess-1");
    assert(loaded !== undefined, "store: round-trip read");
    assert(loaded!.meta.sessionId === "sess-1", "store: round-trip identity");

    const all = await listRecords(storeDir);
    assert(all.length === 2, "store: lists two records across projects");

    const idx = await rebuildIndex(storeDir, all);
    assert(idx.entries.length === 2, "store: index has two entries");
    assert(
      idx.entries[0].analyzedAt >= idx.entries[1].analyzedAt,
      "store: index sorted desc"
    );

    assert(
      isRecordFresh(recordA, {
        transcriptSha256: recordA.meta.transcriptSha256,
        promptParams: recordA.meta.promptParams,
        promptVersion: recordA.meta.promptVersion ?? 1,
        llm: recordA.meta.llm,
      }),
      "store: fresh on identical inputs"
    );
    assert(
      !isRecordFresh(recordA, {
        transcriptSha256: "different",
        promptParams: recordA.meta.promptParams,
        promptVersion: recordA.meta.promptVersion ?? 1,
        llm: recordA.meta.llm,
      }),
      "store: stale on different sha"
    );
    assert(
      !isRecordFresh(recordA, {
        transcriptSha256: recordA.meta.transcriptSha256,
        promptParams: recordA.meta.promptParams,
        promptVersion: (recordA.meta.promptVersion ?? 1) + 1,
        llm: recordA.meta.llm,
      }),
      "store: stale on promptVersion bump"
    );

    const detRoot = buildDeterministicMergeMindMap(all);
    assert(
      (detRoot.children?.length ?? 0) === 2,
      "merge: two project nodes"
    );
    const detRec = buildDeterministicMergeRecord(all);
    assert(detRec.meta.kind === "deterministic", "merge: kind tag");
    assert(detRec.meta.projectSlugs.length === 2, "merge: project slugs");

    const filtered = buildDeterministicMergeMindMap(all, {
      projectSlug: "proj-a",
    });
    assert(filtered.children?.length === 1, "merge: filter by slug");

    // concept-trie deterministic merge smoke test
    const conceptRecord = buildSessionRecord(
      buildRecordMeta({
        sessionId: "concept-sess",
        projectSlug: "proj-concept",
        transcriptPath: "/tmp/concept.jsonl",
        transcriptMtimeMs: 1,
        transcriptSha256: sha256Hex("concept"),
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 2,
        sessionLabel: "concept-sess",
      }),
      {
        topics: [
          {
            title: "Binder",
            conceptPath: ["android", "ipc", "binder"],
            items: [{ text: "tr.code" }],
          },
        ],
      }
    );
    const trie = buildConceptTrieMindMap([conceptRecord]);
    assert(trie.stats.topicsWithPath === 1, "trie: 1 topic with path");
    assert(trie.stats.topicsWithoutPath === 0, "trie: no orphans");
    assert(
      (trie.mindMap.children?.[0]?.data.text ?? "").startsWith("android ("),
      "trie: android at root"
    );

    const key1 = computeMergeCacheKey(
      all,
      { maxTopics: 8, maxItemsPerTopic: 6 },
      "fake"
    );
    const key2 = computeMergeCacheKey(
      [all[1], all[0]],
      { maxTopics: 8, maxItemsPerTopic: 6 },
      "fake"
    );
    assert(key1 === key2, "merge: cache key is order-independent");
    const key3 = computeMergeCacheKey(
      all,
      { maxTopics: 9, maxItemsPerTopic: 6 },
      "fake"
    );
    assert(key1 !== key3, "merge: cache key includes params");
  } finally {
    try {
      rmSync(storeDir, { recursive: true, force: true });
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
