import { readFileSync } from "fs";
import { join } from "path";
import { buildMindMapData } from "../extension/src/mindmap/buildMindMapData";
import { extractUserQuery, parseJsonl } from "../extension/src/transcript/parseJsonl";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(msg);
  }
}

const fixture = readFileSync(
  join(__dirname, "../../test/fixtures/sample.jsonl"),
  "utf8"
);

assert(
  extractUserQuery("<user_query>\nHello\n</user_query>") === "Hello",
  "extractUserQuery"
);

const events = parseJsonl(fixture);
assert(events.some((e) => e.kind === "user_query"), "has user_query");
assert(events.some((e) => e.kind === "tool"), "has tool");
assert(events.some((e) => e.kind === "assistant_summary"), "has summary");

const root = buildMindMapData(events, {
  includeToolCalls: true,
  maxConclusionItems: 8,
});
assert((root.children?.length ?? 0) > 0, "has children");
const q1 = root.children?.[0];
assert(q1?.data.text.startsWith("Q1:"), "Q1 label");
const subs = q1?.children?.map((c) => c.data.text) ?? [];
assert(subs.includes("调研"), "has research branch");
assert(subs.includes("结论"), "has conclusion branch");

const rootNoTools = buildMindMapData(events, {
  includeToolCalls: false,
  maxConclusionItems: 8,
});
const subs2 = rootNoTools.children?.[0]?.children?.map((c) => c.data.text) ?? [];
assert(!subs2.includes("调研"), "no research when disabled");

console.log("All tests passed.");
