import type { AgentHostId } from "../host/types";
import {
  formatMergeSessionAnalysisInput,
  type MergeSessionAnalysisInput,
} from "./mergeSessionAnalysisInput";
import {
  formatSessionAnalysisJsonContract,
  SCOPE_PATH_PREFIX_GUIDANCE_LINES,
} from "./promptSessionAnalysisJsonContract";

/** Bump when {@link buildMergeSessionAnalysisPrompt} JSON schema / instructions change. */
export const MERGE_SESSION_ANALYSIS_PROMPT_VERSION = 9;

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

/** M-merge LLM: one virtual combined session (domains / nodes / outline JSON). */
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
          "- 在其 nodes / outlineRows / segmentEquivalences 基础上，整合后续 `role=batch` 新会话；**保持 snapshot 顶根与主层级稳定**，只扩展或归并新内容。",
          "- 禁止发明与 frozenTopRootKeys 平行的 generic hub；batch 新概念必须 parentKeys 指向 frozen 顶根或其子孙。",
          "- 输出仍是**完整**虚拟综合会话 JSON（不是 diff / steps / changes）。",
        ].join("\n")
      : "";

  return [
    `你是跨会话综合分析助手。下面有 ${sessionCount} 个 ${agentLabel} 会话的概念树 + 大纲（TAB 表，列名见输入 schema）。`,
    "任务：理解各会话结构，整理成**一个**虚拟综合会话，就好像它们原本就是同一次长对话。",
    "",
    "## 如何读输入",
    "下方 `===` 之后为 **输入 schema**（各表列名与含义）及 TAB 数据。读表时注意：",
    "- **nodes**：按 sessionId 过滤；用 childKeys 递归展开子孙子树（domain / 从属判断勿只看单 node 的 evidence）",
    "- **outlineRows**：用 row/parentRow 还原树；conceptPath 以某 node.key（或 aliases）为前缀的枝，内容也属于该 node 语境",
    "- **sessions** 中 role=snapshot：frozenTopRootKeys、frozenDomains 在 delta 下必须遵守（见上文增量合并）",
    "",
    "## Working order（必须按序完成，再输出 JSON）",
    "在脑中**依次**完成下面 1→2→3→4→5，全部做完后再**一次性**输出严格 JSON（不要 markdown / 解释 / ```）。",
    "后一步必须使用前一步的结果；禁止按会话 id 平铺代替概念归并。",
    deltaBlock,
    "",
    "### Step 1 — 跨会话领域 → domains[]",
    "从全部会话归纳顶层领域（3-" + maxDomains + " 个，小写 key）。**勿只看 node 自身 label/evidence**；须结合子树内容：",
    "",
    "**领域信号来源（由浅到深）：**",
    "1. 各会话已有 `domains[]`、`nodes[].domainKeys[]`",
    "2. 每个 node 的 **子孙子树**：沿 `childKeys[]` 递归找到所有后代 node，汇总其 label / aliases / evidence",
    "3. **outlineRows** 中 conceptPath 以该 node（或其 alias key）为前缀的枝：读 summary、中间层 title",
    "4. 若 node 自身 evidence 含糊但子孙/outline 内容高度一致 → 以子树所揭示的主题归纳 domain；若子树跨多个不相关主题 → 该 node 可能不应作为单一 domain 顶根",
    "",
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
    "",
    "**定 parentKeys 前（以输入语境为准，禁止套用固定行业表）：**",
    "1. 对该 node 与候选 parent，分别汇总 **自身 + 子孙子树** 的 domain 信号：domainKeys[]、evidence[]、递归 childKeys 对应 node 的 evidence、以及 outline 中以该 key 为 conceptPath 前缀的 summary/details。",
    "2. 仅当 Step 1 的 domains[] 表明二者（含各自子树）同属可合并领域，或子树 evidence 明确写出从属/包含关系时，才设 parentKeys。",
    "3. **子树 domain 信号无交集且 evidence 未说明跨域从属** → 不得挂到对方子树；各自保留独立顶根或各自 domain 顶根下。",
    "4. 禁止因字面相似、会话共现、或 generic 泛化顶根名，把子树主题明显不同的 node 并入另一 domain。",
    "5. 若 node 自身 evidence 空泛但子树内容清晰 → **以子树内容为准** 判断 domain 与 parent，勿仅凭顶段字面归类。",
    "",
    "**同义归并（第一次）：**",
    "- 同层/同链同义说法合并（保留更短更稳的 canonical key，其余进 aliases）。",
    "- 禁止无 evidence 的合并；**跨 domain（Step 1 中无关领域）禁止合并**。",
    "",
    "### Step 4 — 跨会话第二次同义归并 → segmentEquivalences[] + termAliases[]",
    "在 Step 3 定稿层级上，对可能同义的 path 段逐对判断（必须带 scope，禁止无 scope 全局合并）。",
    "",
    "**工作方式（以理解为主，结构提示为辅）：**",
    "1. 锁定该段 **domain**（Step 1 domains[] + 该段 node 的 domainKeys[] + **其子孙子树** 与 outline 子枝所揭示的主题）。",
    "2. 用 parentKeys / childKeys（含递归后代）/ evidence / outline.conceptPath 弄清位置。",
    "3. 对候选 A、B：**先分别理解** 在各会话、该 domain、该上下级语境下各自指什么。",
    "4. **仅当基于上述理解认为 A 与 B 指同一概念** 时写入 segmentEquivalences；禁止仅因字面相近合并，禁止与 domainKeys/evidence 矛盾的硬并。",
    "5. scope 限定等价成立语境（须与 Step 1 domain 一致；见下列 pathPrefix 约束）：",
    ...SCOPE_PATH_PREFIX_GUIDANCE_LINES,
    "- **并列顶根同义**：domain 须一致；根级写 pathPrefix:[] 时必须**同时**写 evidenceKeywords 或 downstreamFirst，禁止仅 pathPrefix:[]",
    "",
    "### Step 5 — 综合内容大纲 → outline",
    "按**概念**组织（不要按会话 id / 时间平铺）：",
    "- title / summary：整个项目库的总主题",
    "- outline[]：2-4 层，顶层 **2-" + maxBranches + " 条**（与 Step 3 顶根一致）",
    "- 叶子：summary（必填）+ details[]（≤40 字）+ conceptPath（3-5 段）；**conceptPath[0] 必须是 Step 3 统一顶根之一**",
    "- 每叶子 1-" + maxDetails + " 条细节；details 不含 sourceTurnIndices（跨会话无 turn 锚点）",
    "",
    formatSessionAnalysisJsonContract({ includeSourceTurnIndices: false, includeCodeReferences: false }),
    "",
    "只输出严格 JSON（不要 markdown、解释、```）。顶层字段：",
    "- domains[]：顶层领域 key（小写，3-" + maxDomains + " 个）",
    "- nodes[]：{ key, label, aliases[], parentKeys[]（根用 []）, evidence[]（必填，≤80 字） }；可选 mappings[]",
    "- segmentEquivalences[]：{ canonical, aliases[]（≥1，必填）, scope（必填，见 JSON 契约）, confidence? }",
    "- termAliases[]（可选）",
    "- outline：{ title, summary?, outline[] } 2-4 层；叶子含 summary、details[{ text }]、conceptPath（3-5 段）；**不要** details.sourceTurnIndices",
    "",
    "示例（neutral，勿照搬字面）：",
    '{"domains":["software","platform"],"nodes":[{"key":"platform-alpha","label":"Platform Alpha","aliases":["platform-a"],"parentKeys":["platform"],"evidence":["多会话归并 platform-alpha"]},{"key":"subsystem","label":"Subsystem","parentKeys":["platform-alpha"],"evidence":["subsystem 路由"]}],"mappings":[],"segmentEquivalences":[{"canonical":"subsystem","aliases":["core-subsystem"],"scope":{"pathPrefix":["platform-alpha"]},"confidence":0.9}],"termAliases":[],"outline":{"title":"...","summary":"...","outline":[{"title":"...","children":[{"title":"...","summary":"...","conceptPath":["platform","platform-alpha","subsystem"],"details":[{"text":"..."}]}]}]}}',
    "",
    "===",
    body,
  ].join("\n");
}
