import type { AgentHostId } from "../host/types";
import type { SessionRecord } from "../store/storeTypes";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

const MAX_TOTAL_CHARS = 28000;
const MAX_ITEMS_PER_TOPIC = 6;
const MAX_TOPIC_TITLE = 80;
const MAX_ITEM_TEXT = 80;

export const ONTOLOGY_PROMPT_VERSION = 3;

function clip(text: string, max: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function renderRecord(record: SessionRecord, idx: number): string {
  const meta = record.meta;
  const lines: string[] = [];
  lines.push(`[S${idx + 1}] sessionId=${meta.sessionId}`);
  lines.push(`     project=${meta.projectPath ?? meta.projectSlug}`);
  if (record.outline.title) {
    lines.push(`     title=${clip(record.outline.title, MAX_TOPIC_TITLE)}`);
  }
  // We use the derived TopicGraph titles/items as the concept evidence surface.
  for (const topic of record.graph.topics.slice(0, 24)) {
    lines.push(`     - ${clip(topic.title, MAX_TOPIC_TITLE)}`);
    for (const item of (topic.items ?? []).slice(0, MAX_ITEMS_PER_TOPIC)) {
      lines.push(`       · ${clip(item.text, MAX_ITEM_TEXT)}`);
    }
  }
  return lines.join("\n");
}

export function buildOntologyPrompt(
  records: SessionRecord[],
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_LABELS[hostId];
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
    `你是「跨会话概念本体（ontology）抽取」助手。下面是若干个 ${agentLabel} 会话的主题/要点摘要（不是原始 transcript）。`,
    "请抽取并构建一个可用于跨会话自动归类的概念本体，要求：",
    "- nodes[]: 概念节点。key 为 canonical key（小写英文/通用术语，可含短横线），label 为人类可读显示名（可中文）。",
    "- parentKeys[]: 父概念 key（允许 DAG：一个节点可多父）。",
    "- aliases[]: 同义词/别名（大小写/中英文/缩写等）。",
    "- mappings[]: mention->key 的归一化映射（mention 可为别名/术语原形），用于快速把文本提及归到 canonical key。",
    "- 禁止把会话标题或长句当作 key；key 应该是稳定概念（如 frontend / react / hooks / typescript / kubernetes）。",
    "- 不要把某个领域写死（domain 是开放集合），但建议抽取 3-10 个顶层 domain 便于归类。",
    "- 同一概念的多种写法应通过 aliases 与 mappings 归并，不要为别名单独建并列顶层节点（例：reactjs → react）。",
    "- 子概念应挂在合理的父概念之下（例：hooks 的 parent 含 react，而非与 frontend 并列的孤立节点）。",
    "",
    "只输出严格 JSON，不要 markdown、不要解释、不要 ```：",
    '{"nodes":[{"key":"frontend","label":"Frontend","parentKeys":["software"]},{"key":"react","label":"React","aliases":["ReactJS"],"parentKeys":["frontend"]}],"mappings":[{"mention":"ReactJS","key":"react"}],"topicPaths":[]}',
    "",
    "===",
    blocks.join("\n\n") || "(空)",
  ].join("\n");
}

