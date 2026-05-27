import type { NodeOriginRef } from "./transcript/types";

/**
 * Persisted "open this agent right after the next window finishes loading"
 * handover record. We can't keep state in-memory across a `vscode.openFolder`
 * call, so we stash it in `globalState`, then drain it in `activate()`.
 *
 * Lives in this vscode-free module so the test bundle (and any pure
 * consumer) can import the shape without dragging in the `vscode` API
 * surface.
 */
export type PendingJump = {
  expectedSlug: string;
  sessionId: string;
  projectPath?: string;
  transcriptPath?: string;
  turnIndex?: number;
  question?: string;
  expiresAt: number;
};

export const PENDING_JUMP_KEY = "agentMindmap.pendingJump";

/**
 * Flat candidate row used by the picker and the executor. One row per
 * (sessionId, turnIndex) pair; branch / root refs collapse to a single
 * "整段会话" row per session.
 */
export type JumpCandidate = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  /** undefined => the whole session (no specific Q#). */
  turnIndex?: number;
  /** Original user query text for this turn; only set when known. */
  question?: string;
};

/**
 * Pure function (no IO) that dedups refs by `(sessionId, turnIndex)`,
 * preserving first-seen order. The resulting array is the picker's row set
 * before transcript metadata is filled in.
 */
export function flattenCandidates(refs: NodeOriginRef[]): JumpCandidate[] {
  const seen = new Set<string>();
  const out: JumpCandidate[] = [];
  for (const ref of refs) {
    const key = `${ref.sessionId}#${ref.turnIndex ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({
      sessionId: ref.sessionId,
      projectSlug: ref.projectSlug,
      projectPath: ref.projectPath,
      sessionLabel: ref.sessionLabel,
      transcriptPath: ref.transcriptPath,
      turnIndex: ref.turnIndex,
    });
  }
  return out;
}

function trimPreview(text: string, max = 60): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 1) + "…";
}

/**
 * Picker row formatter (pure). Branch / root candidates render as
 * "整段会话"; turn candidates render as "Q{n+1}: <preview>". Exported so
 * tests can assert the user-visible label shape.
 */
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Cursor meta-prompt that searches prior transcripts — not a real topic Q. */
export function isMetaSearchUserQuery(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes("search through my recent agent transcripts") ||
    t.includes("search my recent agent transcripts") ||
    /在.*agent\s+transcripts.*(搜索|查找|search)/i.test(text) ||
    /search.*agent\s+transcripts.*for:/i.test(text)
  );
}

/** Parse `(Q3)` / `(Q1/Q3)` suffixes on mind-map node labels → 0-based turn indices. */
export function parseQTagsFromNodeLabel(label: string): number[] {
  const paren = /\(([^)]*Q\d[^)]*)\)/i.exec(label);
  if (!paren) {
    return [];
  }
  const out: number[] = [];
  for (const m of paren[1].matchAll(/Q(\d+)/gi)) {
    const n = parseInt(m[1], 10);
    if (Number.isInteger(n) && n >= 1) {
      out.push(n - 1);
    }
  }
  return out;
}

export function stripNodeLabelForMatch(label: string): string {
  return label
    .replace(/概述：/g, "")
    .replace(/\s*\(Q[\d/Q]+\)\s*/gi, " ")
    .replace(/核心\d+:\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCitedSessionIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(UUID_RE)) {
    const id = m[0].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function tokenizeForMatch(text: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "是什么",
    "怎么",
    "如何",
    "什么",
    "一个",
    "进行",
    "可以",
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stop.has(w));
  return new Set(tokens);
}

/**
 * Pick the user-query turn in `queries` that best matches a mind-map leaf label.
 */
export function findBestTurnIndex(
  queries: string[],
  hintText: string
): number | undefined {
  const hint = stripNodeLabelForMatch(hintText);
  if (!hint) {
    return undefined;
  }
  const hintTokens = tokenizeForMatch(hint);
  if (!hintTokens.size) {
    return undefined;
  }
  let bestIdx: number | undefined;
  let bestScore = 0;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (isMetaSearchUserQuery(q)) {
      continue;
    }
    const qTokens = tokenizeForMatch(q);
    let score = 0;
    for (const t of hintTokens) {
      if (qTokens.has(t)) {
        score += 2;
      } else if (q.includes(t) || hint.includes(q.slice(0, 12))) {
        score += 1;
      }
    }
    if (/jit/i.test(hint) && /jit/i.test(q)) {
      score += 3;
    }
    if (/oat|aot|dex2oat/i.test(hint) && /oat/i.test(q)) {
      score += 3;
    }
    if (/deopt|instrumentation|hook/i.test(hint) && /deopt|instrumentation|hook/i.test(q)) {
      score += 2;
    }
    if (/解释器|interpreter/i.test(hint) && /解释器|interpreter/i.test(q)) {
      score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestScore >= 2 ? bestIdx : undefined;
}

export function formatPickerLabel(c: JumpCandidate): string {
  if (c.turnIndex === undefined) {
    return "整段会话";
  }
  const preview = c.question ? trimPreview(c.question, 60) : "";
  const head = `Q${c.turnIndex + 1}`;
  return preview ? `${head}: ${preview}` : head;
}
