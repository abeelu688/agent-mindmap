import type { AgentHostId } from "../host/types";
import type { SegmentEquivalence } from "../llm/types";
import type { SessionRecord } from "../store/storeTypes";
import { topicIdForTopic } from "./topicId";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const TOPIC_PATHS_PROMPT_VERSION = 3;

function clip(text: string, max: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

export type OntologyLite = {
  nodes: { key: string; label: string; aliases?: string[]; parentKeys?: string[] }[];
  mappings: { mention: string; key: string }[];
  segmentEquivalences?: SegmentEquivalence[];
};

export function buildTopicPathsPrompt(
  record: SessionRecord,
  ontology: OntologyLite,
  hostId: AgentHostId = "cursor"
): { prompt: string; topics: { topicId: string; title: string }[] } {
  const agentLabel = HOST_LABELS[hostId];
  const sessionId = record.meta.sessionId;
  const projectSlug = record.meta.projectSlug;
  const topics = record.graph.topics.slice(0, 64).map((t) => {
    const items = (t.items ?? []).map((i) => i.text);
    return {
      topicId: topicIdForTopic(record.meta.sessionId, { title: t.title, items: (t.items ?? []) }),
      title: t.title,
      items: items.slice(0, 12).map((x) => clip(x, 80)),
    };
  });

  const prompt = [
    `你是「主题归类」助手。下面是 1 个 ${agentLabel} 会话的主题列表，需要你为每个主题生成 conceptPath（用于跨会话合并）。`,
    "要求：",
    "- conceptPath 是 2-5 段，从最泛领域到最细概念；每段用小写英文/通用术语（可含短横线），不要用整句标题。",
    "- domain 为开放集合，须从会话内容归纳（如 frontend/react、backend/nodejs、devops/kubernetes）。",
    "- 证据中的别名应归一到 ontology 的 canonical key，不要为别名单独建并列 domain 段。",
    "- 子概念应挂在合理的中间层之下（如 React 相关 → frontend → react → …），避免跳过明显父层。",
    "- 尽量复用 ontology 的 canonical key（nodes[].key）作为 path 段；别名要归一化。",
    "- 若 ontology 提供 segmentEquivalences，path 段必须使用 canonical 名（不要用 aliases 里的同义词）。",
    "- 对于不确定的主题，仍给出一个合理 domain（如 software / operating-system / programming-language / tooling），并降低 confidence。",
    "",
    `本会话元信息：sessionId=${sessionId} projectSlug=${projectSlug}`,
    "- 输出里每条 topicPaths[] 必须带上与上面一致的 sessionId 和 projectSlug。",
    "",
    "输入 ontology（简化版）：",
    JSON.stringify(ontology),
    "",
    "输入 topics：",
    JSON.stringify(
      topics.map((t) => ({ topicId: t.topicId, title: t.title, items: t.items })),
      null,
      2
    ),
    "",
    "只输出严格 JSON：",
    '{"topicPaths":[{"topicId":"...","sessionId":"...","projectSlug":"...","conceptPath":["domain","subsystem","concept"],"confidence":0.8,"evidence":["..."]}]}',
  ].join("\n");

  return { prompt, topics: topics.map((t) => ({ topicId: t.topicId, title: t.title })) };
}

