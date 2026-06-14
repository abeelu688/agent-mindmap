import {
  formatMergeSessionAnalysisInput,
  type MergeSessionAnalysisInput,
} from "./mergeSessionAnalysisInput";
import {
  formatSessionAnalysisJsonContract,
  SCOPE_PATH_PREFIX_GUIDANCE_LINES,
} from "./promptSessionAnalysisJsonContract";
import type { AgentHostId } from "../host/types";
import type { OutputLanguage } from "./promptLanguage";

/** Bump when {@link buildMergeSessionAnalysisPrompt} behavior / schema / instructions change. */
export const MERGE_SESSION_ANALYSIS_PROMPT_VERSION = 11;

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export type MergeSessionAnalysisPromptOptions = {
  maxDomains: number;
  maxNodes: number;
  maxBranches: number;
  maxDetailsPerNode: number;
};

/** M-merge LLM: one virtual combined session (domains / nodes / outline JSON). */
export function buildMergeSessionAnalysisPrompt(
  input: MergeSessionAnalysisInput,
  options: MergeSessionAnalysisPromptOptions,
  hostId: AgentHostId = "cursor",
  outputLanguage: OutputLanguage = "English"
): string {
  const agentLabel = HOST_LABELS[hostId];
  const maxDomains = Math.max(1, options.maxDomains);
  const maxNodes = Math.max(1, options.maxNodes);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);
  const sessionCount = input.sessions.length;
  const body = formatMergeSessionAnalysisInput(input);
  const snapshotSession = input.sessions.find((s) => s.role === "snapshot");
  const frozenRoots = snapshotSession?.frozenTopRootKeys?.join("、") ?? "";

  const deltaBlock =
    input.mergeMode === "delta"
      ? [
          "",
          "## Delta merge",
          "",
          `- The first \`role=snapshot\` session is the **already-stable project-level combined map** (virtual id ${input.snapshotSessionId ?? "__project_merge_snapshot__"}).`,
          `- **frozenTopRootKeys** (must remain output top roots): ${frozenRoots || "see snapshot.frozenTopRootKeys"}`,
          "- **frozenDomains**: see snapshot.frozenDomains; output domains[] may only consolidate from them, never add parallel top domains for the batch.",
          "- Integrate later `role=batch` sessions into the snapshot's nodes / outlineRows / segmentEquivalences; **keep snapshot top roots and main hierarchy stable**, only extend or fold new content.",
          "- Do not invent a generic hub parallel to frozenTopRootKeys; batch concepts must have parentKeys pointing to a frozen top root or its descendants.",
          "- Output is still the **complete** virtual combined session JSON, not diff / steps / changes.",
        ].join("\n")
      : "";

  return [
    `You are a cross-session synthesis assistant. Below are concept trees + outlines from ${sessionCount} ${agentLabel} sessions (TAB tables; column meanings are in the input schema).`,
    "Task: understand each session's structure and synthesize them into **one** virtual combined session, as if they were originally one long conversation.",
    "",
    "## Output language rule",
    `Write all user-visible natural-language output fields in ${outputLanguage}: labels, evidence snippets, aliases when a natural translation is appropriate, and any natural-language text you produce.`,
    "Keep JSON property names, canonical `key` values, and schema-required structural tokens stable and lowercase where required.",
    "",
    "## How to read the input",
    "After `===` you will see the **input schema** (table columns and meanings) and TAB data. When reading tables:",
    "- **nodes**: filter by sessionId; recursively expand descendants with childKeys (do not judge domain / containment from a single node's evidence alone)",
    "- **outlineRows**: reconstruct trees using row/parentRow; branches whose conceptPath starts with a node.key (or alias key) also belong to that node's context",
    "- **sessions** with role=snapshot: frozenTopRootKeys and frozenDomains must be obeyed in delta mode (see delta merge above)",
    "",
    "## Working order (complete in order before writing JSON)",
    "Mentally complete steps 1→2→3→4 in order, then output strict JSON once. Do not output markdown, explanations, or ``` fences.",
    "Each later step must use the previous step's results; do not flatten by session id instead of merging concepts.",
    deltaBlock,
    "",
    "### Step 1 — Cross-session domains → domains[]",
    "Derive top-level domains from all sessions (3-" +
      maxDomains +
      " lowercase keys). **Do not only read a node's own label/evidence**; use subtree content:",
    "",
    "**Domain signals (shallow to deep):**",
    "1. Existing `domains[]` and `nodes[].domainKeys[]` from each session",
    "2. Each node's **descendant subtree**: recursively follow `childKeys[]` and aggregate descendant labels / aliases / evidence",
    "3. **outlineRows** branches whose conceptPath starts with that node (or alias key): read summaries and intermediate titles",
    "4. If node evidence is vague but descendants/outline content is consistent, derive the domain from the subtree; if the subtree spans unrelated topics, the node may not be a single domain top root",
    "",
    "In delta mode: **inherit and consolidate** snapshot.frozenDomains; do not add batch top domains parallel to frozen domains.",
    "",
    "### Step 2 — Cross-session concept extraction → nodes[] (max " + maxNodes + ")",
    "Merge nodes across sessions (use domainKeys / aliases / evidence):",
    "- key (canonical, lowercase), label, aliases[], evidence[] (required, <=80 chars; may mention source session id)",
    "- Do **not** set parentKeys yet in this step; optional mappings[]",
    "",
    "### Step 3 — Cross-session hierarchy + first synonym fold → complete nodes[].parentKeys[]",
    "Build one unified DAG (parentKeys[]); **every node must include parentKeys[] (roots use []) and evidence[]**. **At most 2 root nodes may have parentKeys=[]**.",
    "In delta mode: new batch concepts must attach under snapshot.frozenTopRootKeys (do not create parallel top roots).",
    "",
    "**Before assigning parentKeys (use input context; do not apply a fixed industry table):**",
    "1. For the node and each candidate parent, separately aggregate domain signals from **itself + descendant subtree**: domainKeys[], evidence[], recursive childKeys evidence, and outline summaries/details whose conceptPath starts with that key.",
    "2. Assign parentKeys only when Step 1 domains[] says both sides (including subtrees) belong to a mergeable domain, or subtree evidence explicitly states containment/dependency.",
    "3. **If subtree domain signals do not overlap and evidence does not state cross-domain containment**, do not attach one subtree under the other; keep independent top roots or under their own domain roots.",
    "4. Do not merge a node into another domain merely because of string similarity, session co-occurrence, or a generic top-root name when subtree topics differ clearly.",
    "5. If a node's own evidence is vague but subtree content is clear, judge domain and parent by the **subtree content**, not the top segment literal.",
    "",
    "**Synonym fold (first pass):**",
    "- Fold same-level / same-chain synonyms (keep the shorter/stabler canonical key, move others into aliases).",
    "- Never merge without evidence; **never merge across unrelated domains from Step 1**.",
    "",
    "### Step 4 — Cross-session second synonym fold → segmentEquivalences[] + termAliases[]",
    "On top of the finalized Step 3 hierarchy, judge potentially equivalent path segments pair by pair (scope is required; no global unscoped merge).",
    "",
    "**How to work (semantic understanding first, structure as context):**",
    "1. Lock the segment's **domain** (Step 1 domains[] + the node's domainKeys[] + topics revealed by its **descendant subtree** and outline branches).",
    "2. Use parentKeys / childKeys (including recursive descendants) / evidence / outline.conceptPath to understand position.",
    "3. For candidates A/B: **first understand separately** what each means across sessions, within this domain and parent/child context.",
    "4. Write segmentEquivalences **only when that understanding says A and B are the same concept**; do not merge merely by string similarity or against domainKeys/evidence.",
    "5. scope constrains the context where the equivalence is valid (must be consistent with Step 1 domain; see pathPrefix rules):",
    ...SCOPE_PATH_PREFIX_GUIDANCE_LINES,
    "- **Parallel top-root synonym**: domain must match; when root-level pathPrefix:[] is used, also write evidenceKeywords or downstreamFirst; never write only pathPrefix:[]",
    "",
    formatSessionAnalysisJsonContract({
      includeSourceTurnIndices: false,
      includeCodeReferences: false,
      includeOutline: false,
    }),
    "",
    "Output strict JSON only (no markdown, explanations, or ``` fences). Top-level fields:",
    "- domains[]: top-level domain keys (lowercase, 3-" + maxDomains + ")",
    "- nodes[]: { key, label, aliases[], parentKeys[] (roots use []), evidence[] (required, <=80 chars) }; optional mappings[]",
    "- segmentEquivalences[]: { canonical, aliases[] (>=1, required), scope (required, see JSON contract), confidence? }",
    "- termAliases[] (optional)",
    "",
    "Neutral example (do not copy literals):",
    '{"domains":["software","platform"],"nodes":[{"key":"platform-alpha","label":"Platform Alpha","aliases":["platform-a"],"parentKeys":["platform"],"evidence":["merged platform-alpha across sessions"]},{"key":"subsystem","label":"Subsystem","parentKeys":["platform-alpha"],"evidence":["subsystem routing"]}],"mappings":[],"segmentEquivalences":[{"canonical":"subsystem","aliases":["core-subsystem"],"scope":{"pathPrefix":["platform-alpha"]},"confidence":0.9}],"termAliases":[]}',
    "",
    "===",
    body,
  ].join("\n");
}
