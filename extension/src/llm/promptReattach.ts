import type { AgentHostId } from "../host/types";

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export const REATTACH_PROMPT_VERSION = 1;

export type ReattachCandidate = {
  from: string;
  /** Flattened keywords from the subtree for evidence. */
  keywords: string[];
};

export type OntologyLite = {
  nodes: { key: string; label: string; aliases?: string[]; parentKeys?: string[] }[];
  mappings: { mention: string; key: string }[];
};

/**
 * Ask the LLM to suggest patch-style reattachments for suspicious root children.
 * This keeps the final tree deterministic after applying the returned moves.
 */
export function buildReattachPrompt(
  candidates: ReattachCandidate[],
  ontology: OntologyLite,
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_LABELS[hostId];
  return [
    `你是「思维导图结构修复」助手。下面是 ${agentLabel} 合并后的树中若干个“疑似挂错位置”的根下分支，需要你给出重挂载 moves。`,
    "要求：",
    "- moves[].from 必须精确匹配输入 candidates[].from",
    "- moves[].toPath 是 2-5 段 conceptPath（小写英文/通用术语），尽量复用 ontology nodes key",
    "- 不确定就不要输出 move（宁缺毋滥），或给低 confidence",
    "",
    "输入 ontology：",
    JSON.stringify(ontology),
    "",
    "输入 candidates：",
    JSON.stringify(candidates, null, 2),
    "",
    "只输出严格 JSON：",
    '{"moves":[{"from":"...","toPath":["domain","subsystem"],"confidence":0.7,"evidence":["..."]}]}',
  ].join("\n");
}

