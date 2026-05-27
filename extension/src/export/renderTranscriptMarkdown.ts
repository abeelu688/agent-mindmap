import { isMetaSearchUserQuery } from "../jumpToOriginCore";
import type { ChatEvent } from "../transcript/types";

export type RenderedTranscript = {
  markdown: string;
  /** 0-based user_query ordinal → display Q number (matches ## Qn). */
  turnIndexToDisplayQ: Map<number, number>;
  /** Line index (0-based) for each user_query ordinal when focusing in-editor. */
  turnIndexToLine: Map<number, number>;
};

/**
 * Render transcript events as Markdown with stable HTML anchors for offline jumps.
 */
export function renderTranscriptMarkdown(
  events: ChatEvent[],
  title: string
): RenderedTranscript {
  const lines: string[] = [];
  const turnIndexToDisplayQ = new Map<number, number>();
  const turnIndexToLine = new Map<number, number>();

  lines.push(`# ${title}`);
  lines.push("");

  let userQueryOrdinal = -1;
  let displayQ = 0;
  let skipNextAssistant = false;

  for (const ev of events) {
    if (ev.kind === "user_query") {
      userQueryOrdinal += 1;
      if (isMetaSearchUserQuery(ev.text)) {
        skipNextAssistant = true;
        continue;
      }
      skipNextAssistant = false;
      displayQ += 1;
      turnIndexToDisplayQ.set(userQueryOrdinal, displayQ);
      turnIndexToLine.set(userQueryOrdinal, lines.length + 1);
      lines.push(`<a id="q-${displayQ}"></a>`);
      lines.push(`## Q${displayQ}`);
      lines.push("");
      for (const t of ev.text.split(/\r?\n/)) {
        lines.push(`> ${t}`);
      }
      lines.push("");
    } else if (ev.kind === "assistant_summary") {
      if (skipNextAssistant) {
        skipNextAssistant = false;
        continue;
      }
      if (displayQ === 0) {
        continue;
      }
      lines.push(`### A${displayQ}`);
      lines.push("");
      lines.push(ev.text);
      lines.push("");
    }
  }

  return {
    markdown: lines.join("\n"),
    turnIndexToDisplayQ,
    turnIndexToLine,
  };
}

/** Map 0-based turn index to `#q-{displayQ}` fragment, if known. */
export function anchorForTurnIndex(
  turnIndex: number | undefined,
  turnIndexToDisplayQ: Map<number, number>
): string | undefined {
  if (turnIndex === undefined) {
    return undefined;
  }
  const displayQ = turnIndexToDisplayQ.get(turnIndex);
  if (displayQ === undefined) {
    return undefined;
  }
  return `q-${displayQ}`;
}
