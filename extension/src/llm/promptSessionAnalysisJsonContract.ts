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
  "**segmentEquivalences[]**（无同义可 `[]`；写出条目则每条须完整有效，不可缺少scope/aliases条目）：",
  "- `canonical`：非空小写段名",
  "- `aliases`：非空数组，至少 1 个与 canonical 不同的非空字符串",
  "- `scope`：必填对象；其中 **至少一项** 含非空内容：`pathPrefix`（≥1 段）、`downstreamPrefix`、`downstreamFirst`、`projectSlugs`、`evidenceKeywords`",
  "- 根级 `\"pathPrefix\":[]` 时：**必须**同条 scope 里另有非空 `evidenceKeywords` / `downstreamFirst` / `projectSlugs`（仅空 pathPrefix 整条作废）",
  "",
  "**outline**：",
  "- `outline[]`：非空数组",
  "- 最深层叶子：`summary` 必填；`details` 至少 1 条 `{ \"text\": \"非空\" }`",
  "- 中间层：须有非空 `children[]`；有 children 的节点不要挂 `details`",
  "",
  "**codeReferences[]**（机械触发：上文存在 `[F#]` 行则必填；无 `[F#]` 写 `[]`）：",
  "- `path`：**必须原样**取自某 `[F#]` 行的某个路径（相对项目根，不含前导 `/`）；禁止编造、改写、拼接",
  "- `lines`：本方案统一写 `\"-\"`",
  "- `description`：≤60 字，结合 `[Q#]`/`[A#]` 上下文说明该文件被改动/阅读的功能或目的",
  "- 同一文件涉及多个不同功能/目的 → 每条功能各写一条（path 相同，description 不同），不要合并",
];

export function formatSessionAnalysisJsonContract(
  options?: { includeSourceTurnIndices?: boolean; includeCodeReferences?: boolean; includeOutline?: boolean }
): string {
  const lines = [...SESSION_ANALYSIS_JSON_CONTRACT_LINES];
  if (options?.includeSourceTurnIndices) {
    lines.push("- 叶子 `details[]` 可含 `sourceTurnIndices`（0-based，引用本 transcript）");
  } else {
    lines.push("- 跨会话合并：**不要** 在 `details` 里写 `sourceTurnIndices`");
  }
  if (!options?.includeCodeReferences) {
    // Remove codeReferences contract lines for merge prompts (no [F#] lines)
    const codeRefStart = lines.indexOf(
      lines.find((l) => l.startsWith("**codeReferences[]**")) ?? "");
    if (codeRefStart >= 0) {
      // Remove the codeReferences block (header + 3 detail lines)
      lines.splice(codeRefStart, 4);
    }
  }
  if (!options?.includeOutline) {
    // Remove outline contract lines for merge prompts (outline generated deterministically)
    const outlineStart = lines.indexOf(
      lines.find((l) => l.startsWith("**outline**：")) ?? ""
    );
    if (outlineStart >= 0) {
      // Remove outline block (header + 3 detail lines)
      lines.splice(outlineStart, 4);
    }
  }
  return lines.join("\n");
}
