import type { AgentHostId } from "../host/types";
import type { OutlineDetail, OutlineNode } from "./types";
import type { SessionRecord } from "../store/storeTypes";
import { PROMPT_VERSION } from "./promptOutline";

const HOST_MERGE_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

const MAX_DETAILS_PER_NODE = 8;
const MAX_NODE_TITLE = 60;
const MAX_DETAIL_TEXT = 60;
const MAX_TOTAL_CHARS = 30000;

export const MERGE_PROMPT_VERSION = PROMPT_VERSION;

export type MergePromptOptions = {
  maxTopics: number;
  maxItemsPerTopic: number;
};

function clip(text: string, max: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function formatDetail(detail: OutlineDetail, indent: string): string {
  const q =
    detail.sourceTurnIndices?.length
      ? ` @Q${detail.sourceTurnIndices.map((n) => n + 1).join("/Q")}`
      : "";
  return `${indent}· ${clip(detail.text, MAX_DETAIL_TEXT)}${q}`;
}

function renderOutlineNode(
  node: OutlineNode,
  indent: string,
  detailBudget: { remaining: number }
): string[] {
  const lines: string[] = [];
  lines.push(`${indent}- ${clip(node.title, MAX_NODE_TITLE)}`);
  if (node.summary?.trim()) {
    lines.push(`${indent}  (${clip(node.summary, MAX_NODE_TITLE)})`);
  }
  for (const detail of node.details ?? []) {
    if (detailBudget.remaining <= 0) {
      break;
    }
    lines.push(formatDetail(detail, `${indent}    `));
    detailBudget.remaining--;
  }
  for (const child of node.children ?? []) {
    lines.push(...renderOutlineNode(child, indent + "  ", detailBudget));
  }
  return lines;
}

/**
 * Serialise persisted SessionOutline trees for LLM merge (not raw transcripts).
 */
function renderRecord(record: SessionRecord, idx: number): string {
  const meta = record.meta;
  const lines: string[] = [];
  lines.push(`[S${idx + 1}] sessionId=${meta.sessionId}`);
  lines.push(`     project=${meta.projectPath ?? meta.projectSlug}`);
  if (record.outline.title) {
    lines.push(`     title=${clip(record.outline.title, MAX_NODE_TITLE)}`);
  }
  if (record.outline.summary) {
    lines.push(`     summary=${clip(record.outline.summary, MAX_NODE_TITLE)}`);
  }
  const budget = { remaining: MAX_DETAILS_PER_NODE * 4 };
  for (const node of record.outline.outline) {
    lines.push(...renderOutlineNode(node, "     ", budget));
  }
  return lines.join("\n");
}

export function buildMergePrompt(
  records: SessionRecord[],
  options: MergePromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_MERGE_LABELS[hostId];
  const maxTopics = Math.max(2, options.maxTopics);
  const maxItems = Math.max(1, options.maxItemsPerTopic);

  const blocks: string[] = [];
  let total = 0;
  for (let i = 0; i < records.length; i++) {
    const block = renderRecord(records[i], i);
    if (total + block.length + 2 > MAX_TOTAL_CHARS) {
      blocks.push(`[...省略剩余 ${records.length - i} 个会话以适配上下文长度...]`);
      break;
    }
    blocks.push(block);
    total += block.length + 2;
  }

  return [
    `你是「多会话大纲合并」助手。下面是若干个 ${agentLabel} 会话已翻译的分级大纲（每段以 [S#] 开头；@Q# 表示该会话内的用户提问轮次）。`,
    "请合并成一张统一的分级大纲 + 叶子细节，要求：",
    "- title: 5-15 字，名词性短语，跨会话总主题（根节点）",
    "- summary: ≤50 字，可省略",
    `- outline: 2-4 层，顶层 3-${maxTopics} 条分支；中间层只有 children，最细层放 details[]`,
    `  - 每个 details 节点 1-${maxItems} 条，≤40 字`,
    "  - 若要点来自某些输入会话，在 sources 写入 [{ sessionIndex, turnIndex? }]（0-based，[S1]→0，@Q1→turnIndex 0）",
    "- 以主题为中心组织，不要按时间或逐会话罗列",
    "",
    "只输出严格 JSON，不要 markdown、不要解释、不要 ```：",
    '{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","details":[{"text":"...","sources":[{"sessionIndex":0,"turnIndex":0}]}]}]}]}',
    "",
    "===",
    blocks.join("\n\n") || "(空)",
  ].join("\n");
}

export const __testing = { renderRecord, clip, renderOutlineNode };
