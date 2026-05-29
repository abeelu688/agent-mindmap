import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

const MAX_TEXT_PER_BLOCK = 2000;
const MAX_TOTAL_CHARS = 30000;
const MAX_TOOL_LABELS_PER_TURN = 8;

/**
 * Bump this whenever {@link buildPrompt} changes the schema it asks the LLM
 * to produce. The library uses this as a freshness key: records produced by
 * an older prompt version are re-analysed on next open even if the transcript
 * hash and prompt parameters are unchanged.
 *
 * v1: title / summary / topics[].{title, summary, items[]}
 * v2: + topics[].conceptPath  (for cross-session concept-trie merging)
 * v3: stricter sourceTurnIndices — only [Q#] in this transcript
 * v4: conceptPath schema — Android ART under android/art (no runtime parent)
 * v5: neutral conceptPath examples (no Android-specific prompt bias)
 */
export const PROMPT_VERSION = 5;

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
  options: PromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxTopics = Math.max(1, options.maxTopics);
  const maxItems = Math.max(1, options.maxItemsPerTopic);

  return [
    `你是会话主题分析助手。下面是 ${chatLabel} 聊天记录（已脱敏），段标记 [Q#]/[T#]/[A#]。`,
    "归纳整段总主题（用作思维导图根节点，不含日期/ID）：",
    "- title: 5-15 字名词性短语",
    "- summary: ≤50 字一句话，可省",
    "",
    `抽取 3-${maxTopics} 个「核心主题」（按主题、非时间顺序），每个：`,
    "- title: 5-15 字名词性短语",
    "- summary: ≤50 字一句话，可省",
    `- items: 1-${maxItems} 条要点 / 知识点 / 关键提问，每条 ≤40 字`,
    "- items 若引用【本 transcript 内】某轮用户提问，附 sourceTurnIndices（0-based，对应上文 [Q1]→0、[Q2]→1）",
    "- 禁止把助理回复里提到的其他会话/其他 thread 的轮次号写入 sourceTurnIndices；若要点来自助理归纳的其他会话，省略该字段",
    "- conceptPath: 3-5 段，从【最泛领域】到【最细概念】，每段 ≤12 字、小写英文/通用术语，用于跨会话合并按公共前缀聚类；本会话单图不显示。",
    "  层级：第 1 段=领域（frontend / backend / devops / …）；第 2 段=子系统或框架；第 3–5 段=具体主题。同会话内同领域核心必须共享前缀。",
    "  示例：「React Hooks 用法」→ [\"frontend\",\"react\",\"hooks\"]；「Express 中间件」→ [\"backend\",\"nodejs\",\"express\",\"middleware\"]；「K8s Deployment」→ [\"devops\",\"kubernetes\",\"deployment\"]。",
    "  path 必须根据本 transcript 内容归纳，禁止照搬与对话无关的示例路径。",
    "",
    "只输出严格 JSON，不要 markdown / 解释 / ```：",
    '{"title":"...","summary":"...","topics":[{"title":"...","summary":"...","conceptPath":["...","..."],"items":[{"text":"...","sourceTurnIndices":[0,2]}]}]}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}

export const __testing = { groupTurns, renderTurns, clip };
