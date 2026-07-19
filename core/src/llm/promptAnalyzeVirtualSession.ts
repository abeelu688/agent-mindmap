/**
 * Prompt builder for virtual session incremental analysis.
 *
 * A virtual session is a delta fragment of an already-analyzed session: it
 * covers only the new turns added since the last analysis. The LLM is given
 * a compressed "context primer" (prior topic titles + concept paths + key
 * code refs from the original session and any prior virtual sessions) so it
 * can keep concept paths consistent with the existing hierarchy.
 *
 * Output schema is identical to {@link buildSessionAnalysisPrompt} - the
 * result is stored as a `SessionRecord` with `meta.parentSessionId` set.
 *
 * See `plans/virtual-session-incremental-analysis.md` (O4) for the design.
 */
import { __testingPrompt as promptTesting } from "./prompt";
import {
  formatSessionAnalysisJsonContract,
  SCOPE_PATH_PREFIX_GUIDANCE_LINES,
} from "./promptSessionAnalysisJsonContract";
import type { AgentHostId } from "@agent-mindmap/shared";
import type { ChatEvent } from "../transcript/types";
import type { OutputLanguage } from "./promptLanguage";
import type { SessionAnalysisPromptOptions } from "./promptSessionAnalysis";

/** Bump when {@link buildVirtualSessionAnalysisPrompt} behavior or JSON schema changes. */
export const VIRTUAL_SESSION_ANALYSIS_PROMPT_VERSION = 1;

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/**
 * Compressed prior-session context injected into the virtual session prompt
 * (O2). Keeps token cost ~10x smaller than passing the full prior outline.
 */
export type VirtualSessionContextPrimer = {
  /** Label of the original session, for the LLM's situational awareness. */
  originalSessionLabel: string;
  /** 1-based ordinal of this virtual session among the parent's virtuals. */
  virtualSessionIndex: number;
  /**
   * Topic titles + concept paths from the original session and any prior
   * virtual sessions. The LLM should reuse these conceptPath segments when
   * the same concept reappears in the new turns.
   */
  priorTopics: { title: string; conceptPath?: string[] }[];
  /**
   * Key code references from prior analysis - file path + short description.
   * Helps the LLM recognize when a new turn revisits an already-analyzed file.
   */
  priorCodeRefs: { path: string; description: string }[];
};

const { groupTurns, renderTurns } = promptTesting;

export function buildVirtualSessionAnalysisPrompt(
  events: ChatEvent[],
  options: SessionAnalysisPromptOptions,
  contextPrimer: VirtualSessionContextPrimer,
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

  const priorTopicsBlock =
    contextPrimer.priorTopics.length > 0
      ? contextPrimer.priorTopics
          .map((t, i) => {
            const path = t.conceptPath?.length ? ` [${t.conceptPath.join("/")}]` : "";
            return `  ${i + 1}. ${t.title}${path}`;
          })
          .join("\n")
      : "  (none - this is the first virtual session)";

  const priorCodeRefsBlock =
    contextPrimer.priorCodeRefs.length > 0
      ? contextPrimer.priorCodeRefs
          .map((r, i) => `  ${i + 1}. ${r.path} - ${r.description}`)
          .join("\n")
      : "  (none)";

  return [
    "IMPORTANT: You MUST respond with valid JSON only - no prose, no markdown, no explanation, no ``` fences. Start your response with { and end with }.",
    "",
    `You are a session synthesis assistant. Below is a sanitized ${chatLabel} chat transcript representing the CONTINUATION of an existing session (virtual session #${contextPrimer.virtualSessionIndex} of "${contextPrimer.originalSessionLabel}").`,
    "Segment markers are [Q#]/[T#]/[F#]/[A#]; [F#] lists source file paths relative to the project root for that turn.",
    "Analyze ONLY the new turns shown below - do not re-analyze prior turns. Their results are frozen.",
    "",
    "## Prior context (frozen - do not re-analyze)",
    "The original session and any prior virtual sessions have already been analyzed. Their topic titles and concept paths are:",
    "",
    priorTopicsBlock,
    "",
    "Key code references already analyzed:",
    "",
    priorCodeRefsBlock,
    "",
    "## Concept continuity rule",
    "When extracting concepts in Step 2/3 below, **reuse conceptPath segments from the prior context above** when the same concept reappears in the new turns. This keeps the concept hierarchy consistent across virtual sessions and avoids fragmenting the same concept under different paths.",
    "If a new turn introduces a genuinely new concept, derive a fresh conceptPath aligned with the prior hierarchy's domain roots.",
    "",
    "## Output language rule",
    `Write all user-visible natural-language output fields in ${outputLanguage}: labels, evidence snippets, outline titles, summaries, detail text, and aliases when a natural translation is appropriate.`,
    "Keep JSON property names, canonical `key` values, conceptPath segments, and schema-required structural tokens stable and lowercase where required.",
    "",
    "## Working order (complete in order before writing JSON)",
    "Mentally complete steps 1->2->3->4->5 in order, then output strict JSON once. Do not output markdown, explanations, or ``` fences.",
    "Each later step must use the previous step's results; do not skip steps or flatten the analysis by Q/A timeline instead of concepts.",
    "",
    "### Step 1 - Domain analysis -> domains[]",
    "Identify the top-level domains/industries involved in the NEW turns (open set, multi-word allowed; derive from the transcript, do not use a fixed domain table).",
    "Prefer reusing domains implied by the prior context's conceptPaths when the new turns stay in the same domain.",
    "Output 3-" +
      maxDomains +
      " lowercase keys (for example software, platform, backend; derive actual words from this transcript).",
    "",
    "### Step 2 - Term/concept extraction -> nodes[] (max " + maxNodes + ")",
    "Extract technical terms and concepts from the NEW turns. Each item includes:",
    "- key (canonical, lowercase), label, aliases[] (mentions from the transcript), evidence[] (required context snippets, <=80 chars)",
    "- Do **not** set parentKeys yet in this step; optional mappings[] (mention->key)",
    "- If a concept already appears in the prior context (same key or alias), reuse the same canonical key",
    "",
    "### Step 3 - Concept hierarchy + first synonym fold -> complete nodes[].parentKeys[]",
    "Using Step 1 domains and Step 2 nodes, build a DAG hierarchy (parentKeys[]).",
    "**Every node must include parentKeys[] (root concepts use []) and evidence[]**. These fields provide domain/parent/child context for Step 4 and cross-session merge; never omit them.",
    "**Prefer attaching new concepts under existing parent keys from the prior context** when semantically correct - this preserves the cross-virtual-session hierarchy.",
    "**Fold synonyms at the same level or along the same chain in this step** (first fold):",
    "- **Same-level siblings**: if multiple keys under the same parent mean the same concept, keep the shorter/stabler canonical key, move the others into aliases, and remove duplicate nodes",
    "- **Same-chain outer/inner**: if outer/inner effectively refer to the same concept, fold into one canonical key and adjust parentKeys to avoid repeated hierarchy",
    "- Never merge without evidence; never merge across unrelated domains from Step 1",
    "",
    "### Step 4 - Session-level second synonym fold -> segmentEquivalences[] + termAliases[]",
    "On top of the finalized Step 3 hierarchy, rescan the NEW turns and judge potentially equivalent path segments pair by pair (scope is required; no global unscoped merge).",
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
    "### Step 5 - Content outline -> outline",
    "Organize the NEW turns by **actual content/concepts**, not Q/A chronology:",
    "- title / summary: overall topic of this virtual session (not the whole parent session)",
    "- outline[]: 2-4 levels, 2-" + maxBranches + " top branches, clustered by concept",
    "- Leaves: summary (required) + details[] (<=40 chars) + conceptPath (3-5 segments, aligned with Step 3 node hierarchy and prior context conceptPaths, using canonical keys)",
    "- Within the same domain, keep conceptPath root segments consistent with prior context; each leaf has 1-" +
      maxDetails +
      " details",
    "- When referencing user questions in this transcript, use details[].sourceTurnIndices (0-based, relative to the new turns shown below - [Q1]->0, [Q2]->1, etc.)",
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
    body || "(empty virtual session)",
  ].join("\n");
}
