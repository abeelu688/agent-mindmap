import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import { __testing as promptTesting } from "./prompt";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/** Bump when {@link buildSessionExtractPrompt} JSON schema changes. */
export const EXTRACT_PROMPT_VERSION = 1;

export type SessionExtractPromptOptions = {
  maxDomains: number;
  maxTerms: number;
  maxEvidencePerTerm: number;
};

const { groupTurns, renderTurns } = promptTesting;

export function buildSessionExtractPrompt(
  events: ChatEvent[],
  options: SessionExtractPromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxDomains = Math.max(1, options.maxDomains);
  const maxTerms = Math.max(1, options.maxTerms);
  const maxEvidence = Math.max(1, options.maxEvidencePerTerm);

  return [
    `你是会话概念抽取助手。下面是 ${chatLabel} 聊天记录（已脱敏），段标记 [Q#]/[T#]/[A#]。`,
    "请从整段对话中抽取行业/领域信息与专业名词（必须保留上下文证据）：",
    `- domains[]: 本对话涉及的顶层行业/领域（开放集合，3-${maxDomains} 个），小写 key 风格（如 frontend, devops, mobile）`,
    `- terms[]: 专业名词/技术概念，每条包含：`,
    "  - key: canonical key（小写英文/通用术语，可含短横线）",
    "  - label: 人类可读显示名（可中文）",
    "  - mentions[]: 对话中出现的各种写法（含缩写/中英文）",
    `  - evidence[]: 1-${maxEvidence} 条上下文片段（≤80 字，来自对话原文，保留语境）`,
    "  - suggestedParentKey: 可选，父概念 key（通常来自 domains 或更泛术语）",
    `- 最多 ${maxTerms} 个 terms；同一概念多种写法应合并为一条 term（mentions 列全）`,
    "- 禁止把整句会话标题当作 key；key 应是稳定概念",
    "- 不要写死某个产品领域；据本对话实际内容归纳",
    "",
    "只输出严格 JSON，不要 markdown / 解释 / ```：",
    '{"domains":["frontend"],"terms":[{"key":"react","label":"React","mentions":["React","ReactJS"],"evidence":["讨论 useState 与组件状态"],"suggestedParentKey":"frontend"}]}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}
