import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { collectMergeTerms } from "../extension/src/pipeline/stages/collectMergeTerms";
import { deriveEquivalencesFromTopicPaths, buildAllSegmentOverlapHints } from "../extension/src/llm/synonymHintDerive";

const dir = join(process.env.HOME!, ".agent-mindmap/sessions/home-example-cursor-aosp14");
const records = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const collected = collectMergeTerms(records);
const hints = buildAllSegmentOverlapHints(collected.topicPaths, collected.nodes);
const equivs = deriveEquivalencesFromTopicPaths(collected.topicPaths, collected.nodes);

console.log("sessions", records.length, "topicPaths", collected.topicPaths.length);
console.log("hints", hints.length, "equivs", equivs.length);

const interesting = equivs.filter((e) => {
  const blob = [e.canonical, ...(e.aliases ?? [])].join(" ").toLowerCase();
  return /android|aosp|art|runtime/.test(blob);
});
console.log("\n--- target equivalences ---");
for (const e of interesting) {
  console.log(JSON.stringify(e, null, 2));
}

console.log("\n--- root sibling hints ---");
for (const h of hints.filter((h) => h.kind === "sibling" && h.pathPrefix.length === 0)) {
  console.log(JSON.stringify(h));
}
