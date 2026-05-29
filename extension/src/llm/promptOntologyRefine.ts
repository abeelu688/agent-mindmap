import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import type { SessionRecord } from "../store/storeTypes";
import type { ConceptOntology } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import {
  buildRefineContextSamples,
  buildTopicContextIndex,
  type TopicSegmentContext,
} from "./segmentContext";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const ONTOLOGY_REFINE_PROMPT_VERSION = 3;

export type OntologyRefineInput = {
  nodes: ConceptOntology["nodes"];
  mappings: ConceptOntology["mappings"];
  topicPaths: TopicConceptPathDecision[];
  sessions: { sessionId: string; sessionLabel: string; projectSlug: string }[];
  contextSamples: TopicSegmentContext[];
};

export function buildOntologyRefinePrompt(
  input: OntologyRefineInput,
  hostId: AgentHostId = "cursor",
  _promptLanguage?: PromptLanguage
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
    "语境定义（必须用于判断，禁止无 scope 的全局合并）：",
    "- **upstream**：scope.pathPrefix = alias 段之前的 path 前缀（例如 [\"android\",\"art\"] 表示 runtime 出现在 art 之下）。",
    "- **downstream**：alias 之后的 path 后缀；可用 scope.downstreamPrefix 或 scope.downstreamFirst 限定。",
    "- **大纲兄弟**：contextSamples 中的 siblingTitles / outlinePath（同一大纲父节点下的其它 leaf）。",
    "- **证据**：contextSamples 中的 evidence（topic 标题、摘要、要点）。",
    "",
    "要求：",
    "- 每条 equivalence 必须包含 scope（pathPrefix 和/或 evidenceKeywords / downstream 约束），禁止全局无差别合并。",
    "- 例：runtime 作为 android 的**并列**子域时：canonical art，aliases [runtime]，pathPrefix [android]，并附 ART 相关 evidenceKeywords。",
    "- 例：runtime 出现在 android/art **之下**作为冗余子段时：pathPrefix [android, art]，aliases [runtime]（或仅在该下游语境折叠）。",
    "- 不要把 node.js 的 node/runtime 与 Android ART 混淆。",
    "- canonical 应是更短、更稳定的段名；aliases 列出应被替换的同义段。",
    "- confidence 0-1；不确定则不要输出该条。",
    "- 不要输出 nodeMerges；只输出 segmentEquivalences。",
    "",
    "只输出严格 JSON：",
    '{"segmentEquivalences":[{"canonical":"art","aliases":["runtime"],"scope":{"pathPrefix":["android"],"evidenceKeywords":["libart","dex2oat"]},"confidence":0.9,"rationale":"..."}]}',
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
    "",
    "输入 contextSamples（含 segments 上下游切片、大纲兄弟、证据）：",
    JSON.stringify(input.contextSamples, null, 2),
  ].join("\n");
}

export function buildRefineInputFromRecords(
  records: SessionRecord[],
  ontology: Pick<ConceptOntology, "nodes" | "mappings">,
  topicPaths: TopicConceptPathDecision[]
): OntologyRefineInput {
  const index = buildTopicContextIndex(records);
  return {
    nodes: ontology.nodes,
    mappings: ontology.mappings,
    topicPaths,
    sessions: records.map((r) => ({
      sessionId: r.meta.sessionId,
      sessionLabel: r.meta.sessionLabel,
      projectSlug: r.meta.projectSlug,
    })),
    contextSamples: buildRefineContextSamples(topicPaths, index),
  };
}
