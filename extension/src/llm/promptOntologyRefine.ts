import type { AgentHostId } from "../host/types";
import type { SessionRecord } from "../store/storeTypes";
import type { ConceptOntology } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const ONTOLOGY_REFINE_PROMPT_VERSION = 2;

function clip(text: string, max: number): string {
  const t = text.replace(/\r/g, "").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

export type OntologyRefineInput = {
  nodes: ConceptOntology["nodes"];
  mappings: ConceptOntology["mappings"];
  topicPaths: TopicConceptPathDecision[];
  sessions: { sessionId: string; sessionLabel: string; projectSlug: string }[];
};

export function buildOntologyRefinePrompt(
  input: OntologyRefineInput,
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_LABELS[hostId];

  const topicSamples = input.topicPaths.slice(0, 40).map((tp) => {
    const rec = input.sessions.find((s) => s.sessionId === tp.sessionId);
    return {
      sessionId: tp.sessionId,
      projectSlug: tp.projectSlug,
      sessionLabel: rec?.sessionLabel,
      conceptPath: tp.conceptPath,
      confidence: tp.confidence,
    };
  });

  return [
    `你是「概念本体精炼」助手。下面是 ${agentLabel} 多会话分析得到的 ontology 与 topicPaths。`,
    "请识别**带语境的同义 path 段**（segment equivalences），用于合并 Concept Mind Map 中并列的重复分支。",
    "",
    "要求：",
    "- 每条 equivalence 必须包含 scope（pathPrefix 和/或 evidenceKeywords），禁止全局无差别合并。",
    "- 例：在 frontend 语境且证据含 React/JSX/hooks 时，reactjs 可视为 react 的别名；",
    "  但不要把 backend 领域的 api runtime 与 react 混淆合并。",
    "- canonical 应是更短、更稳定的段名；aliases 列出应被替换的同义段。",
    "- confidence 0-1；不确定则不要输出该条。",
    "- 不要输出 nodeMerges；只输出 segmentEquivalences。",
    "",
    "只输出严格 JSON：",
    '{"segmentEquivalences":[{"canonical":"react","aliases":["reactjs"],"scope":{"pathPrefix":["frontend"],"evidenceKeywords":["jsx","hooks","useState"]},"confidence":0.9,"rationale":"..."}]}',
    "",
    "输入 ontology nodes/mappings（摘要）：",
    JSON.stringify({
      nodes: input.nodes.slice(0, 80),
      mappings: input.mappings.slice(0, 120),
    }),
    "",
    "输入 sessions：",
    JSON.stringify(input.sessions),
    "",
    "输入 topicPaths 样本：",
    JSON.stringify(topicSamples, null, 2),
  ].join("\n");
}

export function buildRefineInputFromRecords(
  records: SessionRecord[],
  ontology: Pick<ConceptOntology, "nodes" | "mappings">,
  topicPaths: TopicConceptPathDecision[]
): OntologyRefineInput {
  return {
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths,
    sessions: records.map((r) => ({
      sessionId: r.meta.sessionId,
      sessionLabel: r.meta.sessionLabel,
      projectSlug: r.meta.projectSlug,
    })),
  };
}
