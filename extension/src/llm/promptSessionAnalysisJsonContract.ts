/** Step 4 / scope 说明：与 {@link parseScope} 一致。 */
export const SCOPE_PATH_PREFIX_GUIDANCE_LINES: string[] = [
  "**scope.pathPrefix（与校验器一致，写错会 bad-shape）：**",
  "- **有上级 path**：`pathPrefix` 为该段之前的各段 key（≥1 段）；可再加 `downstreamFirst` / `evidenceKeywords` 收窄语境",
  "- **根级 / conceptPath 第 0 段**（并列顶根、兄弟段）：语义上前缀为空 → 写 `\"pathPrefix\":[]`，但**禁止只写这一项**；必须**同时**提供非空的 `evidenceKeywords` 和/或 `downstreamFirst`（或 `projectSlugs`）",
  "- 例（根级顶段同义）：`\"scope\":{\"pathPrefix\":[],\"evidenceKeywords\":[\"platform\",\"platform-alpha\"]}`",
  "- 例（链内段同义）：`\"scope\":{\"pathPrefix\":[\"platform-alpha\"]}` 或再加 `evidenceKeywords`",
];

/** Lines appended to session-analysis / M-merge prompts — mirrors pipeline validators (bad-shape). */
export const SESSION_ANALYSIS_JSON_CONTRACT_LINES: string[] = [
  "## JSON 契约（校验失败 = bad-shape，缺一项整段输出作废）",
  "",
  "**nodes[]** 每条必填：",
  "- `key`、`label`：非空字符串（key 小写 canonical）",
  "- `parentKeys`：必须是数组（根概念用 `[]`，禁止省略该字段）",
  "- `evidence`：非空数组，至少 1 条 ≤80 字、去空白后非空的上下文片段",
  "",
  "**segmentEquivalences[]**（无同义可 `[]`；写出条目则每条须完整有效，否则整条丢弃并触发 bad-shape）：",
  "- `canonical`：非空小写段名",
  "- `aliases`：非空数组，至少 1 个与 canonical 不同的非空字符串",
  "- `scope`：必填对象；其中 **至少一项** 含非空内容：`pathPrefix`（≥1 段）、`downstreamPrefix`、`downstreamFirst`、`projectSlugs`、`evidenceKeywords`",
  "- 根级 `\"pathPrefix\":[]` 时：**必须**同条 scope 里另有非空 `evidenceKeywords` / `downstreamFirst` / `projectSlugs`（仅空 pathPrefix 整条作废）",
  "",
  "**outline**：",
  "- `outline[]`：非空数组",
  "- 最深层叶子：`summary` 必填；`details` 至少 1 条 `{ \"text\": \"非空\" }`",
  "- 中间层：须有非空 `children[]`；有 children 的节点不要挂 `details`",
];

export function formatSessionAnalysisJsonContract(
  options?: { includeSourceTurnIndices?: boolean }
): string {
  const lines = [...SESSION_ANALYSIS_JSON_CONTRACT_LINES];
  if (options?.includeSourceTurnIndices) {
    lines.push("- 叶子 `details[]` 可含 `sourceTurnIndices`（0-based，引用本 transcript）");
  } else {
    lines.push("- 跨会话合并：**不要** 在 `details` 里写 `sourceTurnIndices`");
  }
  return lines.join("\n");
}
