import assert from "node:assert/strict";
import test from "node:test";
import { buildConceptContextsFromAnalysis } from "../extension/src/llm/buildConceptContexts";
import {
  collectChildEdgesFromOutline,
  enrichAnalysisNodesFromOutline,
} from "../extension/src/llm/enrichNodeChildrenFromOutline";
import { finalizeSessionAnalysis } from "../extension/src/pipeline/stages/finalizeSessionAnalysis";

test("collectChildEdgesFromOutline reads conceptPath on leaves", () => {
  const edges = collectChildEdgesFromOutline({
    outline: [
      {
        title: "Runtime",
        children: [
          {
            title: "JIT",
            summary: "jit",
            conceptPath: ["android", "art", "jit"],
            details: [{ text: "detail" }],
          },
        ],
      },
    ],
  });
  assert.ok(edges.get("android")?.has("art"));
  assert.ok(edges.get("art")?.has("jit"));
});

test("enrichAnalysisNodesFromOutline fills childKeys from outline when parentKeys chain exists", () => {
  const enriched = enrichAnalysisNodesFromOutline({
    domains: ["android"],
    nodes: [
      {
        key: "android",
        label: "Android",
        parentKeys: [],
        evidence: ["platform"],
      },
      {
        key: "art",
        label: "ART",
        parentKeys: ["android"],
        evidence: ["runtime"],
      },
      {
        key: "jit",
        label: "JIT",
        parentKeys: ["art"],
        evidence: ["compile"],
      },
    ],
    segmentEquivalences: [],
    outline: {
      outline: [
        {
          title: "JIT topic",
          summary: "s",
          conceptPath: ["android", "art", "jit"],
          details: [{ text: "d" }],
        },
      ],
    },
  });

  const android = enriched.nodes.find((n) => n.key === "android");
  const art = enriched.nodes.find((n) => n.key === "art");
  const jit = enriched.nodes.find((n) => n.key === "jit");

  assert.deepEqual(android?.childKeys, ["art"]);
  assert.deepEqual(art?.childKeys, ["jit"]);
  assert.deepEqual(jit?.childKeys, undefined);
});

test("enrichAnalysisNodesFromOutline fills children when nodes lack parentKeys but outline has path", () => {
  const enriched = enrichAnalysisNodesFromOutline({
    domains: ["android"],
    nodes: [
      { key: "android", label: "Android", parentKeys: [], evidence: ["a"] },
      { key: "art", label: "ART", evidence: ["b"] },
      { key: "jit", label: "JIT", evidence: ["c"] },
    ],
    segmentEquivalences: [],
    outline: {
      outline: [
        {
          title: "leaf",
          conceptPath: ["android", "art", "jit"],
          details: [{ text: "d" }],
        },
      ],
    },
  });

  const android = enriched.nodes.find((n) => n.key === "android");
  const art = enriched.nodes.find((n) => n.key === "art");
  const jit = enriched.nodes.find((n) => n.key === "jit");

  assert.deepEqual(android?.childKeys, ["art"]);
  assert.deepEqual(art?.childKeys, ["jit"]);
  assert.equal(jit?.parentKeys?.[0], "art");
});

test("finalizeSessionAnalysis aligns conceptContexts childKeys with enriched nodes", () => {
  const finalized = finalizeSessionAnalysis(
    {
      domains: ["android"],
      nodes: [
        {
          key: "android",
          label: "Android",
          parentKeys: [],
          evidence: ["a"],
        },
        {
          key: "art",
          label: "ART",
          parentKeys: ["android"],
          evidence: ["b"],
        },
      ],
      segmentEquivalences: [],
      outline: {
        outline: [
          {
            title: "leaf",
            conceptPath: ["android", "art", "extra-child"],
            details: [{ text: "d" }],
          },
        ],
      },
    },
    { sessionId: "s1", projectSlug: "proj", userQueryCount: 1 }
  );

  const androidNode = finalized.sessionAnalysis.nodes.find(
    (n) => n.key === "android"
  );
  const androidCtx = finalized.conceptContexts.find((c) => c.key === "android");

  assert.ok(androidNode?.childKeys?.includes("art"));
  assert.ok(androidNode?.childKeys?.includes("extra-child"));
  assert.deepEqual(androidCtx?.childKeys, androidNode?.childKeys);
});

test("buildConceptContextsFromAnalysis unions node.childKeys with parentKeys inverse", () => {
  const contexts = buildConceptContextsFromAnalysis(
    {
      domains: ["android"],
      nodes: [
        {
          key: "android",
          label: "Android",
          parentKeys: [],
          childKeys: ["art", "binder"],
          evidence: ["a"],
        },
        {
          key: "art",
          label: "ART",
          parentKeys: ["android"],
          evidence: ["b"],
        },
        {
          key: "binder",
          label: "Binder",
          parentKeys: ["android"],
          evidence: ["c"],
        },
      ],
      segmentEquivalences: [],
      outline: { outline: [] },
    },
    { sessionId: "s1", projectSlug: "proj" }
  );

  const android = contexts.find((c) => c.key === "android");
  assert.deepEqual(android?.childKeys, ["art", "binder"]);
});
