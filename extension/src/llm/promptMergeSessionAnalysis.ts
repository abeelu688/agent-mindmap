import type { AgentHostId } from "../host/types";
import {
  formatMergeSessionAnalysisInput,
  type MergeSessionAnalysisInput,
} from "./mergeSessionAnalysisInput";
import { SESSION_ANALYSIS_PROMPT_VERSION } from "./promptSessionAnalysis";

/** Bump when {@link buildMergeSessionAnalysisPrompt} JSON schema / instructions change. */
export const MERGE_SESSION_ANALYSIS_PROMPT_VERSION = 2;

const HOST_LABELS: Record<AgentHostId, string> = {
  cursor: "Cursor Agent",
  "claude-code": "Claude Code Agent",
};

export type MergeSessionAnalysisPromptOptions = {
  maxDomains: number;
  maxNodes: number;
  maxBranches: number;
  maxDetailsPerNode: number;
};

/**
 * M-merge LLM: same JSON schema as Part I session-analysis — one virtual combined session.
 */
export function buildMergeSessionAnalysisPrompt(
  input: MergeSessionAnalysisInput,
  options: MergeSessionAnalysisPromptOptions,
  hostId: AgentHostId = "cursor"
): string {
  const agentLabel = HOST_LABELS[hostId];
  const maxDomains = Math.max(1, options.maxDomains);
  const maxNodes = Math.max(1, options.maxNodes);
  const maxBranches = Math.max(1, options.maxBranches);
  const maxDetails = Math.max(1, options.maxDetailsPerNode);
  const sessionCount = input.sessions.length;
  const body = formatMergeSessionAnalysisInput(input);
  const snapshotSession = input.sessions.find((s) => s.role === "snapshot");
  const frozenRoots = snapshotSession?.frozenTopRootKeys?.join("、") ?? "";

  const deltaBlock =
    input.mergeMode === "delta"
      ? [
          "",
          "## 增量合并（delta）",
          "",
          `- 第一个 \`role=snapshot\` 的会话是**已稳定的项目综合导图**（虚拟 id ${input.snapshotSessionId ?? "__project_merge_snapshot__"}）。`,
          `- **frozenTopRootKeys**（必须保留为输出顶根）：${frozenRoots || "见 snapshot.frozenTopRootKeys"}`,
          `- **frozenDomains**：见 snapshot.frozenDomains；输出 domains[] 只能在其基础上收拢，禁止 batch 新增并列顶 domain。`,
          "- 在其 nodes / outline.tree / segmentEquivalences 基础上，整合后续 `role=batch` 新会话；**保持 snapshot 顶根与主层级稳定**，只扩展或归并新内容。",
          "- 禁止发明与 frozenTopRootKeys 平行的 generic hub；batch 新概念必须 parentKeys 指向 frozen 顶根或其子孙。",
          "- 输出仍是**完整**虚拟综合会话 JSON（不是 diff / steps / changes）。",
        ].join("\n")
      : "";

  return [
    `你是跨会话综合分析助手。下面有 ${sessionCount} 个 ${agentLabel} 会话的概念树 + 大纲（JSON）。`,
    "任务：理解各会话结构，整理成**一个**虚拟综合会话，就好像它们原本就是同一次长对话。",
    "",
    "## 输入 JSON 字段说明",
    "- 每会话 `nodes[]`：key、label、**domainKeys[]**、parentKeys[]、childKeys[]、**aliases[]**、evidence[]",
    "- 每会话 `outline.tree[]`：2-4 层大纲树（含中间 children；叶子含 conceptPath）",
    "- `role=snapshot` 时另有 **frozenTopRootKeys[]**、**frozenDomains[]**（delta 必须遵守）",
    "",
    "## Working order（必须按序完成，再输出 JSON）",
    "在脑中**依次**完成下面 1→2→3→4→5，全部做完后再**一次性**输出严格 JSON（不要 markdown / 解释 / ```）。",
    "后一步必须使用前一步的结果；禁止按会话 id 平铺代替概念归并。",
    deltaBlock,
    "",
    "### Step 1 — 跨会话领域 → domains[]",
    "从全部会话的 domains、nodes[].domainKeys 归纳顶层领域（3-" +
      maxDomains +
      " 个，小写 key）。",
    "delta 时：**继承并收拢** snapshot.frozenDomains，禁止为 batch 新增与 frozen 并列的顶 domain。",
    "",
    "### Step 2 — 跨会话概念提取 → nodes[]（最多 " + maxNodes + " 个）",
    "合并各会话 nodes（参考 domainKeys / aliases / evidence）：",
    "- key（canonical，小写）、label、aliases[]、evidence[]（≤80 字，必填；可引用来源会话 id）",
    "- 此步先**不要**定 parentKeys；可选 mappings[]",
    "",
    "### Step 3 — 跨会话分级 + 第一次同义归并 → 完善 nodes[].parentKeys[]",
    "建立统一 DAG（parentKeys[]）；**每个 node 必须含 parentKeys[]（根用 []）与 evidence[]**。**parentKeys=[] 的根节点最多 2 个**。",
    "delta 时：batch 新概念必须挂在 snapshot.frozenTopRootKeys 之下（禁止新建并列顶根）。",
    "同层/同链同义说法在此步合并（保留更短更稳的 canonical key）。跨 domain 禁止无 evidence 的合并。",
    "",
    "### Step 4 — 跨会话第二次同义归并 → segmentEquivalences[] + termAliases[]",
    "在 Step 3 定稿层级上，对可能同义的 path 段逐对判断（必须带 scope）。",
    "规则与单会话 session-analysis 相同：结合 nodes[].domainKeys 与上下级语境判断。",
    "",
    "### Step 5 — 综合内容大纲 → outline",
    "按**概念**组织（不要按会话 id / 时间平铺）：",
    "- title / summary：整个项目库的总主题",
    "- outline[]：2-4 层，顶层 **2-" + maxBranches + " 条**（与 Step 3 顶根一致）",
    "- 叶子：summary（必填）+ details[]（≤40 字）+ conceptPath（3-5 段）；**conceptPath[0] 必须是 Step 3 统一顶根之一**",
    "- 每叶子 1-" + maxDetails + " 条细节；details 不含 sourceTurnIndices（跨会话无 turn 锚点）",
    "",
    "只输出严格 JSON，字段与单会话 session-analysis 完全一致（schema v" +
      SESSION_ANALYSIS_PROMPT_VERSION +
      "）：",
    '{"domains":[],"nodes":[{"key":"...","label":"...","aliases":[],"parentKeys":[],"evidence":["..."]}],"mappings":[],"segmentEquivalences":[{"canonical":"...","aliases":[],"scope":{"pathPrefix":[]}}],"termAliases":[],"outline":{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","summary":"...","conceptPath":["..."],"details":[{"text":"..."}]}]}]}}',
    "",
    "===",
    body,
  ].join("\n");
}
