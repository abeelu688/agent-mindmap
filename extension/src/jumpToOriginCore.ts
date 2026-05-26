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
  lineIndex?: number;
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
  /** 0-based line index in the .jsonl for this turn's user message. */
  lineIndex?: number;
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
export function formatPickerLabel(c: JumpCandidate): string {
  if (c.turnIndex === undefined) {
    return "整段会话";
  }
  const preview = c.question ? trimPreview(c.question, 60) : "";
  const head = `Q${c.turnIndex + 1}`;
  return preview ? `${head}: ${preview}` : head;
}
