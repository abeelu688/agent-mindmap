import type { BuildOptions, ChatEvent, MindMapNodeData, MindMapRoot } from "../transcript/types";
import { type SessionMeta, unionChildRefs, withOrigin } from "./origin";

const MAX_LABEL = 120;

function truncate(text: string, max = MAX_LABEL): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function extractHeadings(text: string): string[] {
  const headings: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (m?.[2]) {
      headings.push(truncate(m[2], 80));
    }
  }
  return headings;
}

function extractParagraphBullets(text: string, max: number): string[] {
  const items: string[] = [];
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const line = block.split("\n").find((l) => l.trim().length > 0);
    if (!line) {
      continue;
    }
    const cleaned = line.replace(/^[-*]\s+/, "").replace(/^#+\s+/, "").trim();
    if (cleaned.length > 15 && !cleaned.startsWith("```")) {
      items.push(truncate(cleaned, 100));
    }
    if (items.length >= max) {
      break;
    }
  }
  return items;
}

type Turn = {
  query: string;
  tools: ChatEvent[];
  summary?: ChatEvent;
};

function groupIntoTurns(events: ChatEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;

  for (const ev of events) {
    if (ev.kind === "user_query") {
      if (current) {
        turns.push(current);
      }
      current = { query: ev.text, tools: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    if (ev.kind === "tool") {
      current.tools.push(ev);
    } else if (ev.kind === "assistant_summary") {
      current.summary = ev;
    }
  }
  if (current) {
    turns.push(current);
  }
  return turns;
}

function leaf(text: string): MindMapNodeData {
  return { data: { text: truncate(text) } };
}

function branch(text: string, children: MindMapNodeData[]): MindMapNodeData {
  return {
    data: { text: truncate(text), expand: true },
    children: children.length ? children : undefined,
  };
}

/**
 * Build a chronological "turn-by-turn" mind map (Q1 / Q2 / Q3 …).
 *
 * As of the topic-clustering rewrite this is the *fallback* renderer used when
 * the LLM provider is unavailable or returns unusable output. The default
 * renderer is `buildTopicMindMap` in `./buildTopicMindMap.ts`.
 */
export function buildTurnMindMap(
  events: ChatEvent[],
  options: BuildOptions,
  sessionLabel?: string,
  sessionMeta?: SessionMeta
): MindMapRoot {
  const labels = options.labels ?? {
    research: "调研",
    conclusion: "结论",
    sessionDefault: "Agent Session",
  };
  const turns = groupIntoTurns(events);
  const firstQuery = turns[0]?.query;
  const rootText = sessionLabel
    ? truncate(sessionLabel, 80)
    : firstQuery
      ? truncate(firstQuery, 80)
      : labels.sessionDefault;

  const children: MindMapNodeData[] = turns.map((turn, idx) => {
    const qLabel = `Q${idx + 1}: ${truncate(turn.query, 80)}`;
    const sub: MindMapNodeData[] = [];
    const turnRef = sessionMeta
      ? [{ ...sessionMeta, turnIndex: idx }]
      : undefined;

    if (options.includeToolCalls && turn.tools.length > 0) {
      const toolLeaves = turn.tools.map((t) => {
        const node = leaf(t.kind === "tool" ? t.label : "");
        return turnRef ? withOrigin(node, turnRef) : node;
      });
      const toolBranch = branch(labels.research, toolLeaves);
      sub.push(turnRef ? withOrigin(toolBranch, turnRef) : toolBranch);
    }

    if (turn.summary && turn.summary.kind === "assistant_summary") {
      const headings = extractHeadings(turn.summary.text);
      let conclusionItems =
        headings.length > 0
          ? headings
          : extractParagraphBullets(
              turn.summary.text,
              options.maxConclusionItems
            );

      if (!conclusionItems.length) {
        conclusionItems = [truncate(turn.summary.preview, 100)];
      }

      conclusionItems = conclusionItems.slice(0, options.maxConclusionItems);
      const conclusionLeaves = conclusionItems.map((c) => {
        const node = leaf(c);
        return turnRef ? withOrigin(node, turnRef) : node;
      });
      const conclusionBranch = branch(labels.conclusion, conclusionLeaves);
      sub.push(
        turnRef ? withOrigin(conclusionBranch, turnRef) : conclusionBranch
      );
    }

    if (!sub.length) {
      const node = leaf(qLabel);
      return turnRef ? withOrigin(node, turnRef) : node;
    }

    const node = branch(qLabel, sub);
    return turnRef ? withOrigin(node, turnRef) : node;
  });

  const root: MindMapNodeData = {
    data: { text: rootText, expand: true },
    children: children.length ? children : undefined,
  };

  if (!sessionMeta || !children.length) {
    return root;
  }
  return withOrigin(root, unionChildRefs(children));
}

/** @deprecated Use `buildTurnMindMap` (fallback) or `buildTopicMindMap` (default). */
export const buildMindMapData = buildTurnMindMap;
