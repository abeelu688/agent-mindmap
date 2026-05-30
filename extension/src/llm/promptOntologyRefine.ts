import type { AgentHostId } from "../host/types";
import type { PromptLanguage } from "./promptLanguage";
import type { SessionRecord } from "../store/storeTypes";
import type { ConceptOntology } from "./types";
import type { TopicConceptPathDecision } from "../store/ontologyTypes";
import {
  buildAllSegmentOverlapHints,
  buildRefineContextSamples,
  buildTopicContextIndex,
  type SegmentOverlapHint,
  type TopicSegmentContext,
} from "./segmentContext";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const ONTOLOGY_REFINE_PROMPT_VERSION = 5;

export type OntologyRefineInput = {
  nodes: ConceptOntology["nodes"];
  mappings: ConceptOntology["mappings"];
  topicPaths: TopicConceptPathDecision[];
  sessions: { sessionId: string; sessionLabel: string; projectSlug: string }[];
  contextSamples: TopicSegmentContext[];
  /** DET: sibling + chain + node relationship hints. */
  overlapHints: SegmentOverlapHint[];
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
    "判断必须同时考虑 **domain + 上级节点 + 下级节点**（禁止无 scope 的全局合并）：",
    "1) **domain**：ontology nodes 的 parentKeys / domains、contextSamples.evidence 是否指向同一技术域。",
    "2) **上级（upstream）**：scope.pathPrefix = 该段之前的 path 前缀（根级并列段用 []）。",
    "3) **下级（downstream）**：scope.downstreamFirst / downstreamPrefix 限定 alias 之后出现的子段。",
    "4) **大纲兄弟**：contextSamples.siblingTitles / outlinePath。",
    "",
    "除**并列兄弟段**外，还须检查**同链路上下级**（overlapHints kind=chain）：",
    "- 当大量 path 为 outer/inner/suffix，同时存在 inner/suffix，且 domain+evidence 同指，",
    "  可将 outer 折叠为 inner 的同义（scope.pathPrefix + downstreamFirst: [inner]）。",
    "- 例：platform-wrapper/subsystem/module vs subsystem/module → canonical subsystem，aliases [platform-wrapper]。",
    "",
    "典型并列模式（neutral 示意）：",
    "- 根级：platform-alpha/foo 与 platform-beta/foo 共现 → pathPrefix:[] + downstreamFirst:[foo]。",
    "- 嵌套：pathPrefix [backend] 下 api vs middleware。",
    "",
    "overlapHints（DET 预计算：sibling / chain / node-alias）是强候选，须逐条核对；",
    "node-alias 来自 nodes.aliases 互指；无 overlap 时仍可用 nodes.evidence 输出 scoped equivalence。",
    "",
    "要求：",
    "- 每条 equivalence 必须包含 scope（pathPrefix 和/或 downstreamFirst / downstreamPrefix / evidenceKeywords）。",
    "- canonical 选更短、更稳定的段名；aliases 为应被替换的同义段。",
    "- confidence 0-1；不确定则不要输出。",
    "- 只输出 segmentEquivalences，不要 nodeMerges。",
    "",
    "只输出严格 JSON：",
    '{"segmentEquivalences":[{"canonical":"api","aliases":["middleware"],"scope":{"pathPrefix":["backend"],"downstreamFirst":["router"],"evidenceKeywords":["http handler"]},"confidence":0.9,"rationale":"..."}]}',
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
    "输入 overlapHints（sibling / chain / node-alias）：",
    JSON.stringify(input.overlapHints.slice(0, 32), null, 2),
    "",
    "输入 contextSamples：",
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
    overlapHints: buildAllSegmentOverlapHints(topicPaths, ontology.nodes),
  };
}
