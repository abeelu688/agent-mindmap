import type { ChatEvent } from "../transcript/types";

const MAX_TEXT_PER_BLOCK = 2000;
const MAX_TOTAL_CHARS = 30000;
const MAX_TOOL_LABELS_PER_TURN = 8;

export type PromptOptions = {
  maxTopics: number;
  maxItemsPerTopic: number;
};

type Turn = {
  index: number;
  query?: string;
  tools: string[];
  summary?: string;
};

function clip(text: string, max: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function groupTurns(events: ChatEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | undefined;

  for (const ev of events) {
    if (ev.kind === "user_query") {
      if (current) {
        turns.push(current);
      }
      current = { index: turns.length, query: ev.text, tools: [] };
      continue;
    }
    if (!current) {
      current = { index: turns.length, tools: [] };
    }
    if (ev.kind === "tool") {
      if (current.tools.length < MAX_TOOL_LABELS_PER_TURN) {
        current.tools.push(ev.label);
      }
    } else if (ev.kind === "assistant_summary") {
      current.summary = ev.text;
    }
  }
  if (current) {
    turns.push(current);
  }
  return turns;
}

function renderTurns(turns: Turn[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const turn of turns) {
    const parts: string[] = [];
    if (turn.query) {
      parts.push(`[Q${turn.index + 1}] ${clip(turn.query, MAX_TEXT_PER_BLOCK)}`);
    }
    if (turn.tools.length) {
      parts.push(`[T${turn.index + 1}] ${turn.tools.join(" | ")}`);
    }
    if (turn.summary) {
      parts.push(`[A${turn.index + 1}] ${clip(turn.summary, MAX_TEXT_PER_BLOCK)}`);
    }
    if (!parts.length) {
      continue;
    }
    const block = parts.join("\n");
    if (total + block.length + 2 > MAX_TOTAL_CHARS) {
      blocks.push("[...truncated due to length...]");
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join("\n\n");
}

export function buildPrompt(
  events: ChatEvent[],
  options: PromptOptions
): string {
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxTopics = Math.max(1, options.maxTopics);
  const maxItems = Math.max(1, options.maxItemsPerTopic);

  return [
    "你是会话主题分析助手。下面是一段 Cursor Agent 聊天记录（已脱敏），每段用 [Q#] / [T#] / [A#] 标记。",
    `请抽取 3-${maxTopics} 个「核心主题」（不要按时间顺序、不要逐题罗列），每个核心给出：`,
    "- title: 5-15 字，名词性短语",
    "- summary: 一句话（≤ 50 字），可省略",
    `- items: 1-${maxItems} 条次核心 / 知识点 / 关键提问，每条 ≤ 40 字`,
    "- 在 items 里如果引用了某轮对话，附 sourceTurnIndices（0-based 数组）",
    "",
    "只输出严格 JSON，不要 markdown、不要解释、不要 ```：",
    '{"topics":[{"title":"...","summary":"...","items":[{"text":"...","sourceTurnIndices":[0,2]}]}]}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}

export const __testing = { groupTurns, renderTurns, clip };
