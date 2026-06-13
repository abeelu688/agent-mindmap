import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildTurnMindMap } from "../extension/src/mindmap/buildMindMapData";
import { buildOutlineMindMap } from "../extension/src/mindmap/buildOutlineMindMap";
import { buildTopicMindMap } from "../extension/src/mindmap/buildTopicMindMap";
import { topicGraphToOutline } from "../extension/src/llm/outlineToTopicGraph";
import { validateTopicGraph } from "../extension/src/llm/cursorCliProvider";
import { summarizeSession } from "../extension/src/llm/summarizeSession";
import { LlmProviderError } from "../extension/src/llm/types";
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
import {
  buildMergeSessionAnalysisInput,
  formatMergeSessionAnalysisInput,
  prioritizeNodesForMergeInput,
  serializeOutlineTree,
} from "../extension/src/llm/mergeSessionAnalysisInput";
import {
  MERGE_SESSION_ANALYSIS_PROMPT_VERSION,
  buildMergeSessionAnalysisPrompt,
} from "../extension/src/llm/promptMergeSessionAnalysis";
import { resolveConceptPathWithEquivalences } from "../extension/src/llm/resolveConceptPathWithEquivalences";
import { filterSessionIds, loadEvalConfig } from "../extension/src/eval/loadEvalConfig";
import {
  countMindMapNodes,
  countTrieNodes,
  measureConceptMerge,
  measureSessionCoverage,
  collectSessionIdsAtTerminalTopics,
} from "../extension/src/eval/metrics";
import {
  buildConceptTrieMindMap,
  buildConceptTrieStructure,
} from "../extension/src/store/mergeConceptTrie";
import { computeMergeCacheKey } from "../extension/src/store/mergeLlm";
import { flattenCandidates, formatPickerLabel } from "../extension/src/jumpToOriginCore";
import { runProjectSessionBatch } from "../extension/src/sessionLoader";
import { buildReattachNodeCatalog } from "../extension/src/llm/reattachNodeCatalog";
import { buildReattachPrompt, REATTACH_PROMPT_VERSION } from "../extension/src/llm/promptReattach";
import {
  DeltaReattachValidationError,
  validateDeltaReattachSteps,
} from "../extension/src/llm/validateDeltaReattachSteps";
import { reattachChangesToSteps } from "../extension/src/llm/reattachChanges";
import { MERGE_SNAPSHOT_SESSION_ID } from "../extension/src/store/mergeSnapshot";
import type { ReparentChain, TrieReparentInput } from "../extension/src/llm/trieReparentInput";
import type { AgentHost } from "../extension/src/host/types";
import type { TranscriptSession } from "../extension/src/transcript/types";
import type { SessionMeta } from "../extension/src/mindmap/origin";
import type { NodeOriginRef } from "../extension/src/transcript/types";
import type { SessionRecord } from "../extension/src/store/storeTypes";
import type { SegmentEquivalence } from "../extension/src/llm/types";
import type {
  LlmProvider,
  LlmSummarizeResult,
  SessionOutline,
  SummarizeInput,
  TopicGraph,
} from "../extension/src/llm/types";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

async function main(): Promise<void> {
  const fixture = readFileSync(join(__dirname, "../../test/fixtures/sample.jsonl"), "utf8");

  // parseJsonl
  assert(extractUserQuery("<user_query>\nHello\n</user_query>") === "Hello", "extractUserQuery");

  const events = parseJsonl(fixture);
  assert(
    events.some((e) => e.kind === "user_query"),
    "has user_query"
  );
  assert(
    events.some((e) => e.kind === "tool"),
    "has tool"
  );
  assert(
    events.some((e) => e.kind === "assistant_summary"),
    "has summary"
  );

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
  const turnSubs2 = turnNoTools.children?.[0]?.children?.map((c) => c.data.text) ?? [];
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

  // outline mind map
  const validOutline: SessionOutline = {
    title: "Binder session",
    outline: [
      {
        title: "Binder",
        details: [{ text: "tr.code" }],
      },
    ],
  };
  const outlineRoot = buildOutlineMindMap(validOutline, "session-label");
  assert(outlineRoot.data.text === "Binder session", "outline: root title");
  assert(outlineRoot.children?.[0]?.data.text === "Binder", "outline: branch title");

  // topic mind map (legacy renderer)
  const topicRoot = buildTopicMindMap(validGraph, "session-label");
  assert(topicRoot.data.text === "session-label", "topic: root label");

  // origin bubbling through buildOutlineMindMap
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
  const originOutline = topicGraphToOutline(originGraph);
  const originRoot = buildOutlineMindMap(originOutline, "label", originSessionMeta);
  const topic0Leaf = originRoot.children?.[0]?.children?.find((c) =>
    c.data.text.includes("tr.code 不在 Parcel")
  );
  assert(
    topic0Leaf?.data.origin?.refs.length === 1 && topic0Leaf!.data.origin!.refs[0].turnIndex === 0,
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
  assert(flat[0].sessionId === "A" && flat[0].turnIndex === 0, "flatten: order preserved");
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
    async summarize(_input: SummarizeInput): Promise<LlmSummarizeResult> {
      cacheCalls += 1;
      return validOutline;
    },
  };

  const cacheDir = mkdtempSync(join(tmpdir(), "agent-mindmap-runall-"));
  try {
    const opts = {
      prompt: { maxBranches: 6, maxDetailsPerNode: 6 },
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
        transcriptFreshnessToken: sha256Hex("payload"),
        llm: { provider: "fake", model: "" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        sessionLabel: "sess-1 · now",
        ...overrides,
      });
    const recordA = buildSessionRecord(baseMeta(), validOutline);
    const recordB = buildSessionRecord(
      baseMeta({
        sessionId: "sess-2",
        projectSlug: "proj-b",
        projectPath: "/work/proj-b",
        sessionLabel: "sess-2 · now",
        analyzedAt: Date.now() + 1,
      }),
      validOutline
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
    assert(idx.entries[0].analyzedAt >= idx.entries[1].analyzedAt, "store: index sorted desc");

    assert(
      isRecordFresh(recordA, {
        transcriptFreshnessToken: recordA.meta.transcriptFreshnessToken,
        promptParams: recordA.meta.promptParams,
        promptVersion: recordA.meta.promptVersion ?? 1,
        llm: recordA.meta.llm,
      }),
      "store: fresh on identical inputs"
    );
    assert(
      !isRecordFresh(recordA, {
        transcriptFreshnessToken: "different",
        promptParams: recordA.meta.promptParams,
        promptVersion: recordA.meta.promptVersion ?? 1,
        llm: recordA.meta.llm,
      }),
      "store: stale on different sha"
    );
    assert(
      !isRecordFresh(recordA, {
        transcriptFreshnessToken: recordA.meta.transcriptFreshnessToken,
        promptParams: recordA.meta.promptParams,
        promptVersion: (recordA.meta.promptVersion ?? 1) + 1,
        llm: recordA.meta.llm,
      }),
      "store: stale on promptVersion bump"
    );

    const detRoot = buildDeterministicMergeMindMap(all);
    assert((detRoot.children?.length ?? 0) === 2, "merge: two project nodes");
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
        transcriptFreshnessToken: sha256Hex("concept"),
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 2,
        sessionLabel: "concept-sess",
      }),
      topicGraphToOutline({
        topics: [
          {
            title: "Binder",
            conceptPath: ["android", "ipc", "binder"],
            items: [{ text: "tr.code" }],
          },
        ],
      })
    );
    const trie = buildConceptTrieMindMap([conceptRecord]);
    assert(trie.stats.topicsWithPath === 1, "trie: 1 topic with path");
    assert(trie.stats.topicsWithoutPath === 0, "trie: no orphans");
    assert(
      (trie.mindMap.children?.[0]?.data.text ?? "").startsWith("android ("),
      "trie: android at root"
    );

    const artRuntimeEq: SegmentEquivalence[] = [
      {
        canonical: "art",
        aliases: ["runtime"],
        scope: { pathPrefix: ["android"] },
        confidence: 0.9,
      },
    ];
    assert(
      JSON.stringify(
        resolveConceptPathWithEquivalences(["android", "runtime", "art", "jit"], artRuntimeEq, {
          items: ["libart"],
        })
      ) === JSON.stringify(["android", "art", "jit"]),
      "equivalence: fold runtime under android to art"
    );

    const artJit = buildSessionRecord(
      buildRecordMeta({
        sessionId: "art-jit",
        projectSlug: "aosp",
        transcriptPath: "/tmp/jit.jsonl",
        transcriptMtimeMs: 1,
        transcriptFreshnessToken: sha256Hex("jit"),
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 2,
        sessionLabel: "jit",
      }),
      topicGraphToOutline({
        topics: [
          {
            title: "JIT",
            conceptPath: ["android", "runtime", "art", "jit"],
            items: [{ text: "a" }],
          },
        ],
      })
    );
    const artHook = buildSessionRecord(
      buildRecordMeta({
        sessionId: "art-hook",
        projectSlug: "aosp",
        transcriptPath: "/tmp/hook.jsonl",
        transcriptMtimeMs: 1,
        transcriptFreshnessToken: sha256Hex("hook"),
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 2,
        sessionLabel: "hook",
      }),
      topicGraphToOutline({
        topics: [
          {
            title: "Hook",
            conceptPath: ["android", "art", "instrumentation"],
            items: [{ text: "b" }],
          },
        ],
      })
    );
    const artTrie = buildConceptTrieMindMap([artJit, artHook], {
      applySegmentEquivalences: true,
      segmentEquivalences: artRuntimeEq,
    });
    const artAndroid = artTrie.mindMap.children?.find((c) =>
      (c.data.text ?? "").startsWith("android (")
    );
    assert(!!artAndroid, "trie: art merge has android root");
    const artAndroidKids = artAndroid?.children?.map((c) => c.data.text ?? "") ?? [];
    assert(
      artAndroidKids.filter((l) => l.startsWith("art (")).length === 1,
      "trie: single art under android"
    );
    assert(!artAndroidKids.some((l) => l.startsWith("runtime (")), "trie: no runtime sibling");

    const key1 = computeMergeCacheKey(all, { maxTopics: 8, maxItemsPerTopic: 6 }, "fake");
    const key2 = computeMergeCacheKey(
      [all[1], all[0]],
      { maxTopics: 8, maxItemsPerTopic: 6 },
      "fake"
    );
    assert(key1 === key2, "merge: cache key is order-independent");
    const key3 = computeMergeCacheKey(all, { maxTopics: 9, maxItemsPerTopic: 6 }, "fake");
    assert(key1 !== key3, "merge: cache key includes params");
  } finally {
    try {
      rmSync(storeDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  // runProjectSessionBatch
  const batchSessions: TranscriptSession[] = [
    {
      id: "batch-ok",
      label: "OK",
      filePath: "/tmp/ok.jsonl",
      mtimeMs: 1,
    },
    {
      id: "batch-fail",
      label: "Fail",
      filePath: "/tmp/fail.jsonl",
      mtimeMs: 2,
    },
    {
      id: "batch-cache",
      label: "Cache",
      filePath: "/tmp/cache.jsonl",
      mtimeMs: 3,
    },
  ];
  const stubHost = { id: "cursor" } as AgentHost;
  let batchCalls = 0;
  const batchMessages: string[] = [];
  const batchResult = await runProjectSessionBatch(
    batchSessions,
    "proj-batch",
    stubHost,
    {
      context: { globalStorageUri: { fsPath: "/tmp" } } as never,
      progress: {
        report(u) {
          batchMessages.push(typeof u === "string" ? u : (u.message ?? ""));
        },
      },
    },
    {
      loadSessionFn: async (session, deps, opts) => {
        batchCalls += 1;
        assert(opts?.skipAutoMerge === true, "batch: skipAutoMerge");
        deps.progress?.report("子步骤");
        const prefixed = batchMessages.find((m) => m.includes("子步骤"));
        assert(!!prefixed && /\b\d+\/3\b/.test(prefixed), "batch: prefixed progress with position");
        if (session.id === "batch-fail") {
          throw new Error("batch failure");
        }
        return {
          session,
          mindMap: { data: { text: session.label } },
          source: "topic",
          fromLibrary: session.id === "batch-cache",
        };
      },
    }
  );
  assert(batchCalls === 3, "batch: three load calls");
  assert(batchResult.total === 3, "batch: total");
  assert(batchResult.analyzed === 2, "batch: analyzed");
  assert(batchResult.skippedFresh === 1, "batch: skippedFresh");
  assert(batchResult.failed === 1, "batch: failed");
  assert(batchResult.failures[0]?.sessionId === "batch-fail", "batch: failure id");

  // eval config
  {
    const repoRoot = join(__dirname, "../..");
    const { config, paths } = await loadEvalConfig(repoRoot);
    assert(config.fixtureSet === "aosp14", "eval config: fixtureSet");
    assert(paths.manifestPath.endsWith("manifest.json"), "eval config: manifest path");
    const filtered = filterSessionIds(config, ["a", "b", "c"]);
    assert(filtered.length === 3, "eval config: filter all ids");
    const subset = filterSessionIds({ ...config, sessionFilter: ["a"] }, ["a", "b"]);
    assert(subset.length === 1 && subset[0] === "a", "eval config: filter subset");
  }

  // eval metrics (concept trie)
  {
    const mmNode = {
      data: { text: "root" },
      children: [{ data: { text: "a" }, children: [{ data: { text: "leaf" } }] }],
    };
    assert(countMindMapNodes(mmNode) === 3, "eval: mind map node count");

    const evalTopic = (
      title: string,
      conceptPath: string[] | undefined,
      items: string[] = ["detail"]
    ) => ({
      title,
      conceptPath,
      items: items.map((text) => ({ text })),
    });

    const evalRecords = [
      buildSessionRecord(
        buildRecordMeta({
          sessionId: "ev-s1",
          projectSlug: "home-welde-cursor-aosp14",
          transcriptPath: "/tmp/ev-s1.jsonl",
          transcriptMtimeMs: 1,
          transcriptFreshnessToken: sha256Hex("ev-s1"),
          llm: { provider: "test" },
          promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
          sessionLabel: "ev-s1",
        }),
        topicGraphToOutline({
          topics: [evalTopic("a", ["Platform", "Binder"])],
        })
      ),
      buildSessionRecord(
        buildRecordMeta({
          sessionId: "ev-s2",
          projectSlug: "home-welde-cursor-aosp14",
          transcriptPath: "/tmp/ev-s2.jsonl",
          transcriptMtimeMs: 1,
          transcriptFreshnessToken: sha256Hex("ev-s2"),
          llm: { provider: "test" },
          promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
          sessionLabel: "ev-s2",
        }),
        topicGraphToOutline({
          topics: [evalTopic("b", ["Platform", "ART"])],
        })
      ),
      buildSessionRecord(
        buildRecordMeta({
          sessionId: "ev-s3",
          projectSlug: "home-welde-cursor-aosp14",
          transcriptPath: "/tmp/ev-s3.jsonl",
          transcriptMtimeMs: 1,
          transcriptFreshnessToken: sha256Hex("ev-s3"),
          llm: { provider: "test" },
          promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
          sessionLabel: "ev-s3",
        }),
        topicGraphToOutline({
          topics: [evalTopic("orphan", undefined)],
        })
      ),
    ];
    const evalStructure = buildConceptTrieStructure(evalRecords, {
      projectSlug: "home-welde-cursor-aosp14",
    });
    assert(countTrieNodes(evalStructure.root) > 1, "eval: trie node count");
    const terminal = collectSessionIdsAtTerminalTopics(evalStructure);
    assert(terminal.has("ev-s1") && terminal.has("ev-s2"), "eval: terminal s1 s2");
    assert(!terminal.has("ev-s3"), "eval: orphan not terminal");
    const cov = measureSessionCoverage(evalStructure, ["ev-s1", "ev-s2", "ev-s3"]);
    assert(cov.sessionsAtTerminalTopics === 2, "eval: terminal coverage count");
    assert(cov.sessionsInAnyTopic === 3, "eval: any topic coverage");
    const report = measureConceptMerge(evalRecords, { projectSlug: "home-welde-cursor-aosp14" }, [
      "ev-s1",
      "ev-s2",
      "ev-s3",
    ]);
    assert(report.conceptMerge.totalTopics === 3, "eval: total topics");
    assert(report.conceptMerge.mindMapNodeCount > 0, "eval: mind map nodes");
  }

  // delta batch-2: prompt v22 frozen hubs + parallel-hub validation (aosp14 regression)
  {
    function deltaChain(from: string, sessionIds: string[], chainIndex: number): ReparentChain {
      return {
        chainIndex,
        from,
        label: from,
        topicCount: 1,
        sessionIds,
        childSegments: [],
        pathSamples: [[from]],
        keywords: [],
        subtree: {
          segment: from,
          label: from,
          topicCount: 1,
          childSegments: [],
          children: [],
        },
      };
    }

    const frozenSegments = [
      "art-runtime",
      "forest",
      "androidplatform",
      "cplusplus",
      "column-truncation",
    ];
    const newSegments = ["android", "androidcomponents", "androidlogging", "intent", "aosp"];
    const chains: ReparentChain[] = [
      ...frozenSegments.map((from, i) => deltaChain(from, [MERGE_SNAPSHOT_SESSION_ID], i + 1)),
      ...newSegments.map((from, i) =>
        deltaChain(from, [`batch2-${i}`], frozenSegments.length + i + 1)
      ),
    ];
    const nodeCatalog = buildReattachNodeCatalog(chains);
    const frozenChainIndices = frozenSegments.map((_, i) => i);
    const deltaInput: TrieReparentInput = {
      mergeMode: "delta",
      snapshotSessionId: MERGE_SNAPSHOT_SESSION_ID,
      frozenChainCount: frozenSegments.length,
      frozenChainIndices,
      conceptContexts: [],
      chains,
      topBranches: chains,
      segmentEquivalences: [],
      rootChildSynonymHints: [],
      topBranchSynonymHints: [],
      structuralHints: {
        duplicateTopRoots: [],
        listedChildCollapses: [],
        ontologySubordinates: [],
        prefixSubordinates: [],
      },
      nodeCatalog,
      nodes: [],
    };

    assert(REATTACH_PROMPT_VERSION === 23, "delta: reattach prompt v23");
    const platformChain = nodeCatalog.numberedChains.find((c) => c.from === "androidplatform");
    assert(platformChain, "delta: androidplatform chain");
    const prompt = buildReattachPrompt(deltaInput, "cursor", "zh", "delta");
    assert(prompt.includes("仅 changes"), "delta: changes output");
    assert(
      prompt.includes(`${platformChain!.rootNodeId} (androidplatform)`),
      "delta: frozen id listed"
    );

    const androidChain = nodeCatalog.numberedChains.find((c) => c.from === "android");
    const intentChain = nodeCatalog.numberedChains.find((c) => c.from === "intent");
    const aospChain = nodeCatalog.numberedChains.find((c) => c.from === "aosp");
    assert(androidChain && intentChain && aospChain, "delta: batch2 chains");

    let parallelRejected = false;
    try {
      validateDeltaReattachSteps(
        deltaInput,
        reattachChangesToSteps([{ kind: "attach", hub: "android", node: "intent" }])
      );
    } catch (err) {
      parallelRejected = err instanceof DeltaReattachValidationError;
      if (!parallelRejected) {
        throw err;
      }
    }
    assert(parallelRejected, "delta: parallel hub changes must throw");

    validateDeltaReattachSteps(
      deltaInput,
      reattachChangesToSteps([{ kind: "attach", hub: "androidplatform", node: "aosp" }])
    );
  }

  {
    const rec = buildSessionRecord(
      buildRecordMeta({
        sessionId: "ctx-s1",
        projectSlug: "proj-a",
        transcriptPath: "/tmp/ctx.jsonl",
        transcriptMtimeMs: 1,
        transcriptFreshnessToken: sha256Hex("ctx"),
        analyzedAt: 1,
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 5,
        sessionLabel: "ctx",
      }),
      topicGraphToOutline({
        topics: [{ title: "t", conceptPath: ["hub", "leaf"], items: [{ text: "x" }] }],
      }),
      {
        sessionAnalysis: {
          domains: ["hub-domain"],
          nodes: [{ key: "hub", label: "Hub", parentKeys: [], evidence: ["e"] }],
          segmentEquivalences: [],
          outline: topicGraphToOutline({
            topics: [{ title: "t", conceptPath: ["hub", "leaf"], items: [{ text: "x" }] }],
          }),
        },
        conceptContexts: [
          {
            key: "hub",
            label: "Hub",
            domainKeys: ["hub-domain"],
            parentKeys: [],
            childKeys: ["leaf"],
            aliases: ["hub-alias"],
            evidence: ["ev1"],
            sessionId: "ctx-s1",
            projectSlug: "proj-a",
          },
        ],
      }
    );
    const input = buildMergeSessionAnalysisInput([rec], "full");
    const node = input.sessions[0]?.nodes[0];
    assert(Boolean(node?.domainKeys?.length), "merge input: domainKeys");
    assert(node?.aliases?.includes("hub-alias") ?? false, "merge input: aliases");
    assert(Array.isArray(input.sessions[0]?.outline.tree), "merge input: outline.tree");
    const body = formatMergeSessionAnalysisInput(input);
    assert(body.includes("### nodes"), "merge input: tabular nodes");
    assert(!body.includes('"domainKeys":'), "merge input: no json node keys");
  }

  {
    const snap = buildSessionRecord(
      buildRecordMeta({
        sessionId: MERGE_SNAPSHOT_SESSION_ID,
        projectSlug: "proj-a",
        transcriptPath: "/tmp/snap.jsonl",
        transcriptMtimeMs: 1,
        transcriptFreshnessToken: sha256Hex("snap"),
        analyzedAt: 1,
        llm: { provider: "fake" },
        promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
        promptVersion: 5,
        sessionLabel: "snap",
      }),
      topicGraphToOutline({
        topics: [{ title: "t", conceptPath: ["hub", "x"], items: [{ text: "x" }] }],
      }),
      {
        sessionAnalysis: {
          domains: ["d1"],
          nodes: [
            { key: "hub", label: "Hub", parentKeys: [], evidence: ["e"] },
            { key: "x", label: "X", parentKeys: ["hub"], evidence: ["e2"] },
          ],
          segmentEquivalences: [],
          outline: topicGraphToOutline({
            topics: [{ title: "t", conceptPath: ["hub", "x"], items: [{ text: "x" }] }],
          }),
        },
      }
    );
    const input = buildMergeSessionAnalysisInput(
      [
        snap,
        buildSessionRecord(
          buildRecordMeta({
            sessionId: "batch1",
            projectSlug: "proj-a",
            transcriptPath: "/tmp/b1.jsonl",
            transcriptMtimeMs: 1,
            transcriptFreshnessToken: sha256Hex("b1"),
            analyzedAt: 1,
            llm: { provider: "fake" },
            promptParams: { maxTopics: 6, maxItemsPerTopic: 6 },
            promptVersion: 5,
            sessionLabel: "b1",
          }),
          topicGraphToOutline({
            topics: [{ title: "t", conceptPath: ["a", "b"], items: [{ text: "x" }] }],
          })
        ),
      ],
      "delta",
      MERGE_SNAPSHOT_SESSION_ID
    );
    assert(
      input.sessions[0]?.frozenTopRootKeys?.includes("hub") ?? false,
      "merge input: frozen tops"
    );
    assert(
      input.sessions[0]?.frozenDomains?.includes("d1") ?? false,
      "merge input: frozen domains"
    );
    const prompt = buildMergeSessionAnalysisPrompt(input, {
      maxDomains: 8,
      maxNodes: 64,
      maxBranches: 8,
      maxDetailsPerNode: 4,
    });
    assert(MERGE_SESSION_ANALYSIS_PROMPT_VERSION === 10, "merge prompt v10");
    assert(prompt.includes("frozenTopRootKeys"), "merge prompt: frozen tops");
  }

  {
    const tree = serializeOutlineTree([
      {
        title: "Top",
        children: [
          {
            title: "Mid",
            children: [{ title: "Leaf", conceptPath: ["a", "b"] }],
          },
        ],
      },
    ]);
    assert(
      tree[0]?.children?.[0]?.children?.[0]?.conceptPath?.[0] === "a",
      "merge outline tree depth"
    );
    const nodes = Array.from({ length: 50 }, (_, i) => ({
      key: `n${i}`,
      label: `N${i}`,
      domainKeys: ["d"],
      parentKeys: i === 0 ? [] : [`n${i - 1}`],
      childKeys: [] as string[],
      aliases: [] as string[],
      evidence: ["e"],
    }));
    const kept = prioritizeNodesForMergeInput(nodes, new Set(["n25"]), 5);
    assert(kept[0]?.key === "n0", "merge prioritize: keeps root");
    assert(kept.length === 5, "merge prioritize: cap");
  }

  console.log("All tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
