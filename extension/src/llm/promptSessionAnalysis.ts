import { __testing as promptTesting } from "./prompt";
import {
  formatSessionAnalysisJsonContract,
  SCOPE_PATH_PREFIX_GUIDANCE_LINES,
} from "./promptSessionAnalysisJsonContract";
import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import type { OutputLanguage } from "./promptLanguage";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/** Bump when {@link buildSessionAnalysisPrompt} behavior or JSON schema changes. */
export const SESSION_ANALYSIS_PROMPT_VERSION = 17;

export type SessionAnalysisPromptOptions = {
  maxDomains: number;
  maxNodes: number;
  maxBranches: number;
  maxDetailsPerNode: number;
};

const { groupTurns, renderTurns } = promptTesting;

export function buildSessionAnalysisPrompt(
  events: ChatEvent[],
  options: SessionAnalysisPromptOptions,
  hostId: AgentHostId = "cursor",
  projectPath?: string,
  outputLanguage: OutputLanguage = "English"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns, projectPath);
  const maxDomains = Math.max(1, options.maxDomains);
  const maxNodes = Math.max(1, options.maxNodes);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);

  return [
    `You are a session synthesis assistant. Below is a sanitized ${chatLabel} chat transcript. Segment markers are [Q#]/[T#]/[F#]/[A#]; [F#] lists source file paths relative to the project root for that turn.`,
    "",
    "## Output language rule",
    `Write all user-visible natural-language output fields in ${outputLanguage}: labels, evidence snippets, outline titles, summaries, detail text, and aliases when a natural translation is appropriate.`,
    "Keep JSON property names, canonical `key` values, conceptPath segments, and schema-required structural tokens stable and lowercase where required.",
    "",
    "## Working order (complete in order before writing JSON)",
    "Mentally complete steps 1→2→3→4→5 in order, then output strict JSON once. Do not output markdown, explanations, or ``` fences.",
    "Each later step must use the previous step's results; do not skip steps or flatten the analysis by Q/A timeline instead of concepts.",
    "",
    "### Step 1 — Domain analysis → domains[]",
    "Identify the top-level domains/industries involved in this conversation (open set, multi-word allowed; derive from the transcript, do not use a fixed domain table).",
    "Output 3-" +
      maxDomains +
      " lowercase keys (for example software, platform, backend; derive actual words from this transcript).",
    "",
    "### Step 2 — Term/concept extraction → nodes[] (max " + maxNodes + ")",
    "Extract technical terms and concepts from the transcript. Each item includes:",
    "- key (canonical, lowercase), label, aliases[] (mentions from the transcript), evidence[] (required context snippets, <=80 chars)",
    "- Do **not** set parentKeys yet in this step; optional mappings[] (mention→key)",
    "",
    "### Step 3 — Concept hierarchy + first synonym fold → complete nodes[].parentKeys[]",
    "Using Step 1 domains and Step 2 nodes, build a DAG hierarchy (parentKeys[]).",
    "**Every node must include parentKeys[] (root concepts use []) and evidence[]**. These fields provide domain/parent/child context for Step 4 and cross-session merge; never omit them.",
    "**Fold synonyms at the same level or along the same chain in this step** (first fold):",
    "- **Same-level siblings**: if multiple keys under the same parent mean the same concept, keep the shorter/stabler canonical key, move the others into aliases, and remove duplicate nodes",
    "- **Same-chain outer/inner**: if outer/inner effectively refer to the same concept (for example platform-wrapper/subsystem and subsystem alone), fold into one canonical key and adjust parentKeys to avoid repeated hierarchy",
    "- Never merge without evidence; never merge across unrelated domains from Step 1",
    "",
    "### Step 4 — Session-level second synonym fold → segmentEquivalences[] + termAliases[]",
    "On top of the finalized Step 3 hierarchy, rescan the transcript and judge potentially equivalent path segments pair by pair (scope is required; no global unscoped merge).",
    "",
    "**How to work (semantic understanding first, structure as context):**",
    "1. First lock the segment's **domain** (Step 1 domains[] + the domain implied by the node's parentKeys chain).",
    "2. Use Step 3 **parents (parentKeys) and children** (same-level siblings / sub-concepts / evidence dependencies) as context to understand the segment's place in the concept tree.",
    "3. For each candidate pair A/B: **first understand separately** what A and B mean in this conversation, this domain, and this parent/child context (use nodes[].evidence and the transcript).",
    "4. Write segmentEquivalences **only when that understanding says A and B are the same concept**. Do not merge merely because strings are similar/same, and do not force a merge that contradicts the semantics.",
    "",
    "scope constrains the path context where the equivalence is valid:",
    ...SCOPE_PATH_PREFIX_GUIDANCE_LINES,
    "- **Same-chain fold**: when outer/inner/suffix and inner/suffix refer to the same thing, use inner as canonical and include outer in aliases; scope uses non-empty pathPrefix plus optional downstreamFirst",
    "- segmentEquivalences[]: { canonical, aliases[] (>=1, required), scope (required, see JSON contract), confidence? }",
    "- termAliases[] (optional): term-level aliases { canonical, aliases[], evidence[] }",
    "",
    "### Step 5 — Content outline → outline",
    "Organize by **actual content/concepts**, not Q/A chronology:",
    "- title / summary: overall topic of the session",
    "- outline[]: 2-4 levels, 2-" + maxBranches + " top branches, clustered by concept",
    "- Leaves: summary (required) + details[] (<=40 chars) + conceptPath (3-5 segments, aligned with Step 3 node hierarchy, using canonical keys)",
    "- Within the same domain, keep conceptPath root segments consistent when possible; each leaf has 1-" +
      maxDetails +
      " details",
    "- When referencing user questions in this transcript, use details[].sourceTurnIndices (0-based)",
    "",
    formatSessionAnalysisJsonContract({
      includeSourceTurnIndices: true,
      includeCodeReferences: false,
    }),
    "",
    "Output strict JSON only. Neutral example (do not copy literals):",
    '{"domains":["software","platform"],"nodes":[{"key":"platform-alpha","label":"Platform Alpha","aliases":["platform-a"],"parentKeys":["platform"],"evidence":["discussion of the platform-alpha module"]},{"key":"subsystem","label":"Subsystem","aliases":["core-subsystem"],"parentKeys":["platform-alpha"],"evidence":["subsystem handles routing"]}],"mappings":[],"segmentEquivalences":[{"canonical":"subsystem","aliases":["core-subsystem"],"scope":{"pathPrefix":["platform-alpha"],"evidenceKeywords":["routing"]},"confidence":0.9}],"termAliases":[],"outline":{"title":"...","outline":[{"title":"...","children":[{"title":"...","summary":"...","conceptPath":["platform","platform-alpha","subsystem"],"details":[{"text":"...","sourceTurnIndices":[0]}]}]}]}}',
    "",
    "===",
    body || "(empty session)",
  ].join("\n");
}
