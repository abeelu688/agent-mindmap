import type { AgentHostId } from "../host/types";
import type { ChatEvent } from "../transcript/types";
import { __testing as promptTesting } from "./prompt";

const HOST_CHAT_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

/** Bump when {@link buildSessionAnalysisPrompt} JSON schema changes. */
export const SESSION_ANALYSIS_PROMPT_VERSION = 5;

export type SessionAnalysisPromptOptions = {
  maxDomains: number;
  maxNodes: number;
  maxBranches: number;
  maxDetailsPerNode: number;
};

const { groupTurns, renderTurns } = promptTesting;

export function buildSessionAnalysisPrompt(
  events: ChatEvent[],
  options: SessionAnalysisPromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const chatLabel = HOST_CHAT_LABELS[hostId];
  const turns = groupTurns(events);
  const body = renderTurns(turns);
  const maxDomains = Math.max(1, options.maxDomains);
  const maxNodes = Math.max(1, options.maxNodes);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);

  return [
    `你是会话综合分析助手。下面是 ${chatLabel} 聊天记录（已脱敏），段标记 [Q#]/[T#]/[A#]。`,
    "",
    "## Working order（必须按序完成，再输出 JSON）",
    "在脑中**依次**完成下面 1→2→3→4→5，全部做完后再**一次性**输出严格 JSON（不要 markdown / 解释 / ```）。",
    "后一步必须使用前一步的结果；禁止跳步或按 Q/A 时间线平铺代替概念分析。",
    "",
    "### Step 1 — 领域分析 → domains[]",
    "识别本对话涉及的顶层领域/行业（开放集合，可多词；从原文归纳，不要套用固定领域表）。",
    "输出 3-" + maxDomains + " 个，小写 key（如 software、platform、backend 等**从本 transcript 归纳**的词）。",
    "",
    "### Step 2 — 专业名词提取 → nodes[]（最多 " + maxNodes + " 个）",
    "从原文抓取专业名词/概念，每项含：",
    "- key（canonical，小写）、label、aliases[]（原文 mention）、evidence[]（≤80 字上下文片段，必填）",
    "- 此步先**不要**定 parentKeys；可选 mappings[]（mention→key）",
    "",
    "### Step 3 — 概念分级 + 第一次同义归并 → 完善 nodes[].parentKeys[]",
    "基于 Step 1 的 domains 与 Step 2 的 nodes，建立 DAG 上下级（parentKeys[]）。",
    "**每个 node 必须含 parentKeys[]（根概念用 []）与 evidence[]**——将用于跨会话合并时的 domain/上级/下级语境，不可省略。",
    "**在本步合并同层/同链上的同义说法**（第一次归并）：",
    "- **同层并列**：同一 parent 下多个 key 若指同一概念，保留更短更稳的 canonical key，其余写入 aliases 并删除重复 node",
    "- **同链上下级**：若 outer/inner 实际同指（如 platform-wrapper/subsystem 与 subsystem 单独出现），合并为单一 canonical key，调整 parentKeys 使层级不重复",
    "- 禁止无 evidence 的合并；跨 domain（Step 1 中无关领域）禁止合并",
    "",
    "### Step 4 — 本对话第二次同义归并 → segmentEquivalences[] + termAliases[]",
    "在 Step 3 定稿的层级上，再扫全文做 **path 段**同义（必须带 scope，禁止无 scope 全局合并）：",
    "- 判断须同时看 **domain（Step 1 + nodes.parentKeys）+ 上级 + 下级**",
    "- **并列兄弟**：scope.pathPrefix = 该段之前的 path（根级用 []）；若两并列段共享 downstream，用 downstreamFirst / evidenceKeywords 限定",
    "- **同链折叠**：outer/inner/suffix 与 inner/suffix 同指时，canonical 取 inner，aliases 含 outer，scope 含 pathPrefix + downstreamFirst",
    "- segmentEquivalences[]：{ canonical, aliases[], scope, confidence? }",
    "- termAliases[]（可选）：term 级别名 { canonical, aliases[], evidence[] }",
    "",
    "### Step 5 — 内容大纲 → outline",
    "按**实际内容/概念**组织（不要按 Q/A 时间顺序平铺）：",
    "- title / summary：整段总主题",
    "- outline[]：2-4 层，顶层 2-" + maxBranches + " 条，按概念聚类",
    "- 叶子：summary（必填）+ details[]（≤40 字）+ conceptPath（3-5 段，与 Step 3 nodes 层级一致，段名用 canonical key）",
    "- 同一 domain 内 conceptPath 根段尽量统一；每叶子 1-" + maxDetails + " 条细节",
    "- 引用本 transcript 用户提问时 details[].sourceTurnIndices（0-based）",
    "",
    "只输出严格 JSON，示例（neutral，勿照搬字面）：",
    '{"domains":["software","platform"],"nodes":[{"key":"platform-alpha","label":"Platform Alpha","aliases":["platform-a"],"parentKeys":["platform"],"evidence":["讨论 platform-alpha 模块"]},{"key":"subsystem","label":"Subsystem","aliases":["core-subsystem"],"parentKeys":["platform-alpha"],"evidence":["subsystem 负责路由"]}],"mappings":[],"segmentEquivalences":[{"canonical":"subsystem","aliases":["core-subsystem"],"scope":{"pathPrefix":["platform-alpha"],"evidenceKeywords":["routing"]},"confidence":0.9}],"termAliases":[],"outline":{"title":"...","outline":[{"title":"...","children":[{"title":"...","summary":"...","conceptPath":["platform","platform-alpha","subsystem"],"details":[{"text":"...","sourceTurnIndices":[0]}]}]}]}}',
    "",
    "===",
    body || "(空会话)",
  ].join("\n");
}
