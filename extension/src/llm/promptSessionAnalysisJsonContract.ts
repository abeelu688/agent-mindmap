/** Step 4 / scope guidance: must stay aligned with parseScope validators. */
export const SCOPE_PATH_PREFIX_GUIDANCE_LINES: string[] = [
  "**scope.pathPrefix (validator-aligned; invalid scope causes bad-shape):**",
  "- **With an upstream path**: `pathPrefix` is the list of segment keys before the segment being equated (>=1 segment); add `downstreamFirst` / `evidenceKeywords` when the context needs narrowing",
  '- **Root level / conceptPath segment 0** (parallel top roots or sibling roots): semantic prefix is empty, so write `"pathPrefix":[]`, but **never write only that field**; also provide non-empty `evidenceKeywords` and/or `downstreamFirst` (or `projectSlugs`)',
  '- Example (root-level top segment equivalence): `"scope":{"pathPrefix":[],"evidenceKeywords":["platform","platform-alpha"]}`',
  '- Example (inside a chain): `"scope":{"pathPrefix":["platform-alpha"]}` or add `evidenceKeywords`',
];

/** Lines appended to session-analysis / M-merge prompts — mirrors pipeline validators (bad-shape). */
export const SESSION_ANALYSIS_JSON_CONTRACT_LINES: string[] = [
  "## JSON contract (validator failure = bad-shape; one missing required field invalidates the whole output)",
  "",
  "**nodes[]** required on every item:",
  "- `key`, `label`: non-empty strings (`key` is lowercase canonical)",
  "- `parentKeys`: must be an array (root concepts use `[]`; do not omit this field)",
  "- `evidence`: non-empty array, at least 1 context snippet <=80 chars after trimming",
  "",
  "**segmentEquivalences[]** (`[]` when none; each written item must be complete and valid, including scope/aliases):",
  "- `canonical`: non-empty lowercase segment name",
  "- `aliases`: non-empty array, at least 1 non-empty string different from canonical",
  "- `scope`: required object; **at least one** field must have non-empty content: `pathPrefix` (>=1 segment), `downstreamPrefix`, `downstreamFirst`, `projectSlugs`, `evidenceKeywords`",
  '- For root-level `"pathPrefix":[]`: the same scope **must** also include non-empty `evidenceKeywords` / `downstreamFirst` / `projectSlugs` (empty pathPrefix alone invalidates the item)',
  "",
  "**outline**:",
  "- `outline[]`: non-empty array",
  '- Deepest leaf nodes: `summary` is required; `details` has at least 1 item `{ "text": "non-empty" }`',
  "- Intermediate nodes: must have non-empty `children[]`; nodes with children must not carry `details`",
  "",
  "**codeReferences[]** (mechanical trigger: if the prompt contains `[F#]` lines, this field is required; if no `[F#]`, write `[]`):",
  "- `path`: **must exactly match** a path from a `[F#]` line (relative to project root, no leading `/`); do not invent, rewrite, or concatenate paths",
  '- `lines`: always write `"-"` in this design',
  "- `description`: <=60 chars, use `[Q#]`/`[A#]` context to describe the file's function or purpose in the change/read",
  "- If one file has several distinct purposes, write one item per purpose (same path, different description); do not merge them",
];

export function formatSessionAnalysisJsonContract(options?: {
  includeSourceTurnIndices?: boolean;
  includeCodeReferences?: boolean;
  includeOutline?: boolean;
}): string {
  const lines = [...SESSION_ANALYSIS_JSON_CONTRACT_LINES];
  if (options?.includeSourceTurnIndices) {
    lines.push(
      "- Leaf `details[]` may include `sourceTurnIndices` (0-based, within this transcript)"
    );
  } else {
    lines.push("- Cross-session merge: **do not** write `sourceTurnIndices` inside `details`");
  }
  if (!options?.includeCodeReferences) {
    // Remove codeReferences contract lines for merge prompts (no [F#] lines)
    const codeRefStart = lines.indexOf(
      lines.find((l) => l.startsWith("**codeReferences[]**")) ?? ""
    );
    if (codeRefStart >= 0) {
      const nextBlock = lines.findIndex((l, idx) => idx > codeRefStart && l.startsWith("**"));
      lines.splice(codeRefStart, (nextBlock >= 0 ? nextBlock : lines.length) - codeRefStart);
    }
  }
  if (!options?.includeOutline) {
    // Remove outline contract lines for merge prompts (outline generated deterministically)
    const outlineStart = lines.indexOf(lines.find((l) => l.startsWith("**outline**：")) ?? "");
    if (outlineStart >= 0) {
      // Remove outline block (header + 3 detail lines)
      lines.splice(outlineStart, 4);
    }
  }
  return lines.join("\n");
}
