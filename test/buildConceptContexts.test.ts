import assert from "node:assert/strict";
import { test } from "vitest";
import { buildConceptContextsFromAnalysis } from "../extension/src/llm/buildConceptContexts";

test("buildConceptContextsFromAnalysis derives childKeys and domainKeys", () => {
  const contexts = buildConceptContextsFromAnalysis(
    {
      domains: ["android"],
      nodes: [
        {
          key: "android",
          label: "Android",
          parentKeys: [],
          evidence: ["android platform"],
        },
        {
          key: "art",
          label: "ART",
          parentKeys: ["android"],
          evidence: ["art runtime"],
        },
        {
          key: "jit",
          label: "JIT",
          parentKeys: ["art"],
          evidence: ["jit compilation"],
        },
      ],
      segmentEquivalences: [],
      outline: { outline: [] },
    },
    { sessionId: "s1", projectSlug: "proj" }
  );

  const art = contexts.find((c) => c.key === "art");
  const android = contexts.find((c) => c.key === "android");
  const jit = contexts.find((c) => c.key === "jit");

  assert.ok(android);
  assert.deepEqual(android.childKeys, ["art"]);
  assert.ok(art);
  assert.deepEqual(art.parentKeys, ["android"]);
  assert.deepEqual(art.childKeys, ["jit"]);
  assert.ok(art.domainKeys.includes("android"));
  assert.ok(jit);
  assert.deepEqual(jit.parentKeys, ["art"]);
});
