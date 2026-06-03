import type { AgentHostId } from "../host/types";
import type { SessionConceptExtract } from "./types";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/** Bump when {@link buildSessionSynonymsPrompt} JSON schema changes. */
export const SESSION_SYNONYM_PROMPT_VERSION = 2;

export function buildSessionSynonymsPrompt(
  extract: SessionConceptExtract,
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_LABELS[hostId];

  return [
    `你是「单会话概念同义精炼」助手。下面是该 ${agentLabel} 会话的概念抽取结果（domains、terms）。`,
    "请在**保留上下文**的前提下识别同义 path 段与 term 别名：",
    "",
    "segmentEquivalences[]（带 scope，禁止无 scope 全局合并）：",
    "- canonical + aliases[] + scope（pathPrefix≥1 段 / downstreamPrefix / downstreamFirst / evidenceKeywords / projectSlugs 至少一项非空）",
    "- 根级写 pathPrefix:[] 时须**同时**写非空 evidenceKeywords 或 downstreamFirst；仅 {\"pathPrefix\":[]} 无效",
    "- 例：reactjs → react，pathPrefix [frontend]，evidenceKeywords 来自 term evidence",
    "",
    "termAliases[]（term 级别名，非 path 段）：",
    "- canonical: term key；aliases[]: 应归并的 mention；evidence[]: 支持判断的片段",
    "",
    "要求：",
    "- 仅合并本对话语境下明确的同义；不确定则不输出",
    "- confidence 0-1；scope 必须能区分不同技术栈中的同名段",
    "",
    "只输出严格 JSON：",
    '{"segmentEquivalences":[{"canonical":"react","aliases":["reactjs"],"scope":{"pathPrefix":["frontend"],"evidenceKeywords":["hooks"]},"confidence":0.9}],"termAliases":[{"canonical":"react","aliases":["ReactJS"],"evidence":["讨论 React 组件"]}]}',
    "",
    "输入（JSON）：",
    JSON.stringify(extract, null, 2),
  ].join("\n");
}
