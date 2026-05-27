import type { AgentHostId } from "../host/types";
import type { SegmentEquivalence } from "../llm/types";
import type { SessionRecord } from "../store/storeTypes";
import { ONTOLOGY_PROMPT_VERSION } from "./promptOntology";
import { PROMPT_VERSION as OUTLINE_PROMPT_VERSION } from "./promptOutline";
import { topicIdForTopic } from "./topicId";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const TOPIC_PATHS_PROMPT_VERSION = 2;

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
    "- domain 不要写死（开放集合）。如果明显属于某个 domain/subsystem（例如 android/art、android/ipc、ios/runtime、linux/kernel），请给出对应前缀。",
    "- Android/AOSP：domain 段必须用 android，不要用 aosp 作为第一段或并列段（AOSP 是 android 源码发行版，应视为 android 的别名）。",
    "- JNI / libart / ArtMethod / dex2oat 等 ART 相关：路径必须含 android → art → jni（或更细），禁止 android → jni 跳过 art。",
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
    "",
    `附：promptVersions ontology=${ONTOLOGY_PROMPT_VERSION}, topicPaths=${TOPIC_PATHS_PROMPT_VERSION}, outlineSchema=${OUTLINE_PROMPT_VERSION}`,
  ].join("\n");

  return { prompt, topics: topics.map((t) => ({ topicId: t.topicId, title: t.title })) };
}

