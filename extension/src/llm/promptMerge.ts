import type { SessionRecord } from "../store/storeTypes";

const MAX_ITEMS_PER_TOPIC_INPUT = 6;
const MAX_TOPIC_TITLE = 60;
const MAX_ITEM_TEXT = 60;
const MAX_TOTAL_CHARS = 30000;

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

/**
 * Serialise a SessionRecord as a compact text block the LLM can read. We feed
 * it already-summarised topic graphs rather than raw transcripts, so the
 * merge prompt is dramatically cheaper than the per-session analysis.
 */
function renderRecord(record: SessionRecord, idx: number): string {
  const meta = record.meta;
  const lines: string[] = [];
  lines.push(`[S${idx + 1}] sessionId=${meta.sessionId}`);
  lines.push(`     project=${meta.projectPath ?? meta.projectSlug}`);
  if (record.graph.title) {
    lines.push(`     title=${clip(record.graph.title, MAX_TOPIC_TITLE)}`);
  }
  if (record.graph.summary) {
    lines.push(`     summary=${clip(record.graph.summary, MAX_TOPIC_TITLE)}`);
  }
  for (const topic of record.graph.topics) {
    const pathSuffix =
      topic.conceptPath && topic.conceptPath.length
        ? `  @ ${topic.conceptPath.join(" / ")}`
        : "";
    lines.push(`     - ${clip(topic.title, MAX_TOPIC_TITLE)}${pathSuffix}`);
    const items = topic.items.slice(0, MAX_ITEMS_PER_TOPIC_INPUT);
    for (const item of items) {
      lines.push(`         · ${clip(item.text, MAX_ITEM_TEXT)}`);
    }
  }
  return lines.join("\n");
}

export function buildMergePrompt(
  records: SessionRecord[],
  options: MergePromptOptions
): string {
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
    "你是「多会话主题合并」助手。下面是若干个 Cursor Agent 会话已经被分析过的主题图，每段以 [S#] 开头。",
    "每个核心后面如果有 `@ a / b / c` 字样，表示其概念路径（从最泛领域到最细概念）。优先按这些路径的公共前缀去合并/聚类同类主题。",
    "请把它们合并成一张统一的思维导图，要求：",
    "- title: 5-15 字，名词性短语，概括跨会话的总主题（用作根节点）",
    "- summary: 一句话（≤ 50 字）整体概述，可省略",
    `- 抽取 5-${maxTopics} 个跨会话「核心主题」，重点是合并/去重同义主题、并保留差异点`,
    "- 每个核心主题给出：",
    "  - title: 5-15 字，名词性短语",
    "  - summary: 一句话（≤ 50 字），可省略",
    "  - conceptPath: 3-5 段概念路径，从最泛领域到最细概念（与单会话同字段语义一致，用于以后再合并）",
    `  - items: 1-${maxItems} 条要点，每条 ≤ 40 字`,
    "- 不要保留时间顺序、不要逐会话罗列；以主题为中心组织内容",
    "- 在每个 item 里如果某条要点显著来自某些会话，在 sourceTurnIndices 字段写入这些会话在输入里的下标（0-based，对应 [S1] 是 0，[S2] 是 1，依此类推）",
    "",
    "只输出严格 JSON，不要 markdown、不要解释、不要 ```：",
    '{"title":"...","summary":"...","topics":[{"title":"...","summary":"...","conceptPath":["...","..."],"items":[{"text":"...","sourceTurnIndices":[0,2]}]}]}',
    "",
    "===",
    blocks.join("\n\n") || "(空)",
  ].join("\n");
}

export const __testing = { renderRecord, clip };
