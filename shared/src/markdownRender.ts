import type {
  ConceptContextForMerge,
  MergeRecord,
  MindMapNodeData,
  OutlineNode,
  SearchHit,
  SessionRecord,
} from "./storeTypes";

const MAX_EVIDENCE = 8;
const MAX_SNIPPET = 240;

function truncate(text: string, max = MAX_SNIPPET): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, max - 3) + "...";
}

function nodeText(node: MindMapNodeData): string {
  return node.data?.text ?? node.nodeData?.text ?? "";
}

function renderMindMapChildren(nodes: MindMapNodeData[], depth: number, limit: number): string[] {
  const lines: string[] = [];
  let count = 0;
  for (const node of nodes) {
    if (count >= limit) {
      lines.push(`${"  ".repeat(depth)}- …`);
      break;
    }
    const text = nodeText(node);
    if (!text.trim()) {
      continue;
    }
    lines.push(`${"  ".repeat(depth)}- ${text}`);
    count++;
    const children = node.children ?? [];
    if (children.length && depth < 2) {
      lines.push(...renderMindMapChildren(children, depth + 1, Math.max(1, limit - count)));
    }
  }
  return lines;
}

export function renderConceptTrieTopLevel(
  merge: MergeRecord | undefined,
  projectSlug: string,
  limit = 12
): string {
  if (!merge?.mindMap) {
    return `_No concept trie merge found for project \`${projectSlug}\`. Run **Analyze All Sessions** first._`;
  }
  const children = merge.mindMap.children ?? [];
  if (!children.length) {
    return `_Concept trie is empty for \`${projectSlug}\`._`;
  }
  const trieProjects = merge.meta.projectSlugs ?? [];
  const isProjectScoped = trieProjects.length === 1 && trieProjects[0] === projectSlug;
  const lines: string[] = [];
  if (!isProjectScoped && trieProjects.length && !trieProjects.includes(projectSlug)) {
    return `_Concept trie does not include \`${projectSlug}\`. Run **Analyze All Sessions (Current Project)** to refresh._`;
  }
  if (!isProjectScoped) {
    lines.push(
      `## Concept map (top level)`,
      `_Trie is shared across projects: ${trieProjects.map((p) => `\`${p}\``).join(", ") || "(none)"}_`,
      ""
    );
  } else {
    lines.push(`## Concept map (top level)`, "");
  }
  lines.push(...renderMindMapChildren(children, 0, limit));
  return lines.join("\n");
}

function renderOutlineNode(node: OutlineNode, depth: number): string[] {
  const lines = [`${"  ".repeat(depth)}- **${node.title}**`];
  if (node.summary?.trim()) {
    lines.push(`${"  ".repeat(depth + 1)}${truncate(node.summary)}`);
  }
  for (const detail of node.details ?? []) {
    if (detail.text?.trim()) {
      lines.push(`${"  ".repeat(depth + 1)}- ${truncate(detail.text, 160)}`);
    }
  }
  for (const child of node.children ?? []) {
    lines.push(...renderOutlineNode(child, depth + 1));
  }
  return lines;
}

export function renderSessionOutlineMarkdown(record: SessionRecord): string {
  const { meta, outline } = record;
  const lines = [
    `# Session: ${meta.sessionLabel}`,
    "",
    `- **sessionId**: \`${meta.sessionId}\``,
    `- **projectSlug**: \`${meta.projectSlug}\``,
  ];
  if (meta.projectPath) {
    lines.push(`- **projectPath**: \`${meta.projectPath}\``);
  }
  lines.push(`- **analyzedAt**: ${new Date(meta.analyzedAt).toISOString()}`, "");
  if (outline.title?.trim()) {
    lines.push(`## ${outline.title}`, "");
  }
  if (outline.summary?.trim()) {
    lines.push(truncate(outline.summary, 400), "");
  }
  if (outline.outline.length) {
    lines.push("## Outline", "");
    for (const node of outline.outline) {
      lines.push(...renderOutlineNode(node, 0));
    }
  }
  if (record.conceptContexts?.length) {
    lines.push("", "## Key concepts", "");
    for (const ctx of record.conceptContexts.slice(0, 20)) {
      lines.push(`- **${ctx.label}** (\`${ctx.key}\`)`);
      for (const ev of ctx.evidence.slice(0, 3)) {
        lines.push(`  - ${truncate(ev, 160)}`);
      }
    }
  }
  return lines.join("\n");
}

export function renderProjectBriefing(opts: {
  projectSlug: string;
  projectPath?: string;
  records: SessionRecord[];
  conceptTrie?: MergeRecord;
  recentLimit?: number;
  conceptLimit?: number;
}): string {
  const recentLimit = opts.recentLimit ?? 5;
  const sorted = [...opts.records].sort((a, b) => b.meta.analyzedAt - a.meta.analyzedAt);
  const lines = [
    `# Project briefing: ${opts.projectPath ?? opts.projectSlug}`,
    "",
    `- **projectSlug**: \`${opts.projectSlug}\``,
    `- **analyzed sessions**: ${sorted.length}`,
  ];
  if (opts.projectPath) {
    lines.push(`- **projectPath**: \`${opts.projectPath}\``);
  }
  lines.push("");
  lines.push(
    renderConceptTrieTopLevel(opts.conceptTrie, opts.projectSlug, opts.conceptLimit ?? 12)
  );
  lines.push("");
  lines.push("## Recent sessions", "");
  if (!sorted.length) {
    lines.push(
      "_No analyzed sessions. Run **Analyze All Sessions (Current Project)** in Agent Mind Map._"
    );
  } else {
    for (const record of sorted.slice(0, recentLimit)) {
      const title = record.outline.title ?? record.meta.sessionLabel;
      const summary = record.outline.summary ?? record.outline.outline[0]?.summary ?? "";
      lines.push(`### ${title}`);
      lines.push(`- sessionId: \`${record.meta.sessionId}\``);
      if (summary.trim()) {
        lines.push(`- ${truncate(summary, 200)}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function renderConceptDetail(
  key: string,
  contexts: ConceptContextForMerge[],
  records: SessionRecord[]
): string {
  const matches = contexts.filter((c) => c.key === key || c.label === key);
  if (!matches.length) {
    return `_No concept found for key \`${key}\`._`;
  }
  const lines = [`# Concept: ${matches[0].label}`, "", `- **key**: \`${matches[0].key}\``];
  const domains = [...new Set(matches.flatMap((m) => m.domainKeys))];
  if (domains.length) {
    lines.push(`- **domains**: ${domains.map((d) => `\`${d}\``).join(", ")}`);
  }
  const parents = [...new Set(matches.flatMap((m) => m.parentKeys))];
  if (parents.length) {
    lines.push(`- **parents**: ${parents.map((p) => `\`${p}\``).join(", ")}`);
  }
  const children = [...new Set(matches.flatMap((m) => m.childKeys))];
  if (children.length) {
    lines.push(`- **children**: ${children.map((c) => `\`${c}\``).join(", ")}`);
  }
  const aliases = [...new Set(matches.flatMap((m) => m.aliases ?? []))];
  if (aliases.length) {
    lines.push(`- **aliases**: ${aliases.map((a) => `\`${a}\``).join(", ")}`);
  }
  lines.push("", "## Evidence", "");
  let evCount = 0;
  for (const ctx of matches) {
    for (const ev of ctx.evidence) {
      if (evCount >= MAX_EVIDENCE) {
        lines.push("- …");
        break;
      }
      lines.push(`- [${ctx.sessionId}] ${truncate(ev)}`);
      evCount++;
    }
  }
  const sessionIds = [...new Set(matches.map((m) => m.sessionId))];
  lines.push("", "## Related sessions", "");
  for (const sessionId of sessionIds) {
    const record = records.find((r) => r.meta.sessionId === sessionId);
    const label = record?.meta.sessionLabel ?? sessionId;
    lines.push(`- \`${sessionId}\` — ${label}`);
  }
  return lines.join("\n");
}

export function renderSearchResults(query: string, hits: SearchHit[], limit: number): string {
  if (!hits.length) {
    return `_No matches for \`${query}\` in analyzed project history._`;
  }
  const lines = [
    `# Search: ${query}`,
    "",
    `Showing ${Math.min(hits.length, limit)} result(s).`,
    "",
  ];
  for (const hit of hits.slice(0, limit)) {
    lines.push(`## ${hit.conceptLabel ?? hit.sessionLabel}`);
    lines.push(`- **type**: ${hit.kind}`);
    lines.push(`- **sessionId**: \`${hit.sessionId}\``);
    if (hit.conceptKey) {
      lines.push(`- **concept**: \`${hit.conceptKey}\``);
    }
    if (typeof hit.evidenceIndex === "number") {
      lines.push(`- **evidenceIndex**: ${hit.evidenceIndex}`);
    }
    lines.push(`- ${hit.snippet}`);
    for (const ev of hit.evidence.slice(0, 3)) {
      lines.push(`  - ${truncate(ev, 160)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderProjectList(
  projects: {
    projectSlug: string;
    projectPath?: string;
    sessionCount: number;
    lastAnalyzedAt: number;
  }[]
): string {
  if (!projects.length) {
    return "_No analyzed projects in Agent Mind Map store. Run **Analyze All Sessions** first._";
  }
  const lines = ["# Analyzed projects", ""];
  for (const p of projects) {
    lines.push(
      `- **${p.projectPath ?? p.projectSlug}** (\`${p.projectSlug}\`) — ${p.sessionCount} session(s), last analyzed ${new Date(p.lastAnalyzedAt).toISOString()}`
    );
  }
  return lines.join("\n");
}

export function renderProjectSessionsList(
  projectSlug: string,
  records: SessionRecord[],
  opts: { limit: number; offset: number; total: number }
): string {
  if (!records.length) {
    if (opts.total === 0) {
      return `_No analyzed sessions for project \`${projectSlug}\`._`;
    }
    return `_No sessions in range for \`${projectSlug}\` (offset=${opts.offset}, total=${opts.total})._`;
  }
  const end = Math.min(opts.offset + records.length, opts.total);
  const lines = [
    `# Sessions: ${projectSlug}`,
    "",
    `Showing ${opts.offset + 1}-${end} of ${opts.total} session(s) (most recent first).`,
    "",
  ];
  for (const record of records) {
    const title = record.outline.title ?? record.meta.sessionLabel;
    lines.push(`- \`${record.meta.sessionId}\` — ${title}`);
    const summary = record.outline.summary ?? record.outline.outline[0]?.summary ?? "";
    if (summary.trim()) {
      lines.push(`  - ${truncate(summary, 200)}`);
    }
    lines.push(`  - analyzedAt: ${new Date(record.meta.analyzedAt).toISOString()}`);
  }
  return lines.join("\n");
}
