import { runLlmStage } from "../pipeline/llmStage";
import { groupTurns, toRelPath, isProjectRelativePath } from "./prompt";
import { filterProjectCodeReferences } from "./filterCodeReferences";
import { LlmProviderError } from "./types";
import type { ChatEvent } from "../transcript/types";
import type { CodeReference, LlmProvider, OutlineNode, SessionOutline } from "./types";
import type { MindMapProgress } from "../progress";

/** A file path with the surrounding turn context for description generation. */
export type FileEntry = {
  path: string;
  turnIndex: number;
  query: string;
  summary: string;
  topicContexts?: string[];
  /** Derived from the Write/StrReplace tool call that produced the file. */
  writeKind?: "create" | "modify" | "delete";
  /**
   * First chars of the written content (from Write.contents or StrReplace.new_string).
   * Shared per unique path — taken from the most informative write op ("create" beats "modify").
   */
  contentSnippet?: string;
};

function truncateContext(text: string, max = 180): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 3) + "..." : t;
}

function buildTopicContextByTurn(outline?: SessionOutline): Map<number, string[]> {
  const byTurn = new Map<number, string[]>();
  if (!outline?.outline?.length) {
    return byTurn;
  }

  const add = (turnIndex: number, text: string) => {
    const t = truncateContext(text);
    if (!t) {
      return;
    }
    const arr = byTurn.get(turnIndex) ?? [];
    if (!arr.includes(t)) {
      arr.push(t);
      byTurn.set(turnIndex, arr);
    }
  };

  const walk = (node: OutlineNode, parents: string[]) => {
    const path = [...parents, node.title].filter(Boolean);
    const topic = path.join(" > ");
    for (const detail of node.details ?? []) {
      const turnIndices = detail.sourceTurnIndices ?? [];
      for (const turnIndex of turnIndices) {
        const context = node.summary?.trim()
          ? `${topic}\uff1a${node.summary.trim()}\uff1b${detail.text}`
          : `${topic}\uff1a${detail.text}`;
        add(turnIndex, context);
      }
    }
    for (const child of node.children ?? []) {
      walk(child, path);
    }
  };

  for (const node of outline.outline) {
    walk(node, []);
  }
  return byTurn;
}

type WriteInfo = {
  writeKind: "create" | "modify" | "delete";
  contentSnippet?: string;
};

/**
 * Scan events to build a per-file write-info map.
 * Only files touched by Write / StrReplace / EditNotebook / Delete are included.
 * "create" (Write) beats "modify" (StrReplace) when choosing the representative snippet.
 */
function buildWriteInfoMap(events: ChatEvent[], projectPath?: string): Map<string, WriteInfo> {
  const map = new Map<string, WriteInfo>();
  for (const ev of events) {
    if (ev.kind !== "tool" || !ev.writeKind || ev.writeKind === "delete") {
      continue;
    }
    for (const rawPath of ev.filePaths ?? []) {
      const rel = toRelPath(rawPath, projectPath);
      if (!rel || !isProjectRelativePath(rel, projectPath)) {
        continue;
      }
      const existing = map.get(rel);
      // "create" is always preferred; don't downgrade an existing "create" to "modify"
      if (!existing || (ev.writeKind === "create" && existing.writeKind !== "create")) {
        map.set(rel, { writeKind: ev.writeKind, contentSnippet: ev.contentSnippet });
      } else if (existing.writeKind === "modify" && !existing.contentSnippet && ev.contentSnippet) {
        // Keep the first non-empty snippet for "modify" paths
        existing.contentSnippet = ev.contentSnippet;
      }
    }
  }
  return map;
}

/** Extract file paths and their turn context from ChatEvents (deterministic, no LLM).
 *  Strategy A: only files that were actually written/modified in this session.
 */
export function extractFilePathsFromEvents(
  events: ChatEvent[],
  projectPath?: string,
  outline?: SessionOutline
): FileEntry[] {
  // Strategy A: only files with write operations get descriptions
  const writeInfoMap = buildWriteInfoMap(events, projectPath);
  if (!writeInfoMap.size) {
    return [];
  }

  const turns = groupTurns(events);
  const topicContextByTurn = buildTopicContextByTurn(outline);
  const seen = new Map<string, FileEntry[]>();

  for (const turn of turns) {
    if (!turn.filePaths.length) {
      continue;
    }
    const query = turn.query?.trim() ?? "";
    const summary = turn.summary?.trim() ?? "";

    for (const rawPath of turn.filePaths) {
      const rel = toRelPath(rawPath, projectPath);
      if (!rel || !isProjectRelativePath(rel, projectPath)) {
        continue;
      }
      // Strategy A: skip read-only files
      const writeInfo = writeInfoMap.get(rel);
      if (!writeInfo) {
        continue;
      }
      let entries = seen.get(rel);
      if (!entries) {
        entries = [];
        seen.set(rel, entries);
      }
      // Deduplicate by (path, query, summary) across all turns —
      // same file with identical context in different turns is redundant
      const already = entries.some((e) => e.query === query && e.summary === summary);
      if (!already) {
        entries.push({
          path: rel,
          turnIndex: turn.index,
          query,
          summary,
          topicContexts: topicContextByTurn.get(turn.index),
          writeKind: writeInfo.writeKind,
          contentSnippet: writeInfo.contentSnippet,
        });
      }
    }
  }

  // Flatten, sorted by path then turn index
  const all: FileEntry[] = [];
  for (const path of [...seen.keys()].sort()) {
    all.push(...seen.get(path)!);
  }
  return all;
}

function buildFallbackReferences(entries: FileEntry[]): CodeReference[] {
  const groups = new Map<string, { path: string; desc: string; turns: number[] }>();
  for (const e of entries) {
    const fb = fallbackDescription(e);
    const key = `${e.path}\0${fb}`;
    let g = groups.get(key);
    if (!g) {
      g = { path: e.path, desc: fb, turns: [] };
      groups.set(key, g);
    }
    g.turns.push(e.turnIndex);
  }
  return [...groups.values()].map((g) => ({
    path: g.path,
    lines: "-",
    description: g.desc,
    sourceTurnIndices: g.turns,
  }));
}

/** Build local placeholder references while the description LLM runs in the background. */
export function buildPendingCodeReferencesFromEvents(
  events: ChatEvent[],
  projectPath?: string,
  outline?: SessionOutline
): CodeReference[] {
  const entries = extractFilePathsFromEvents(events, projectPath, outline);
  if (!entries.length) {
    return [];
  }
  const now = Date.now();
  return filterProjectCodeReferences(
    buildFallbackReferences(entries).map((ref) => ({
      ...ref,
      llmStatus: "pending" as const,
      llmUpdatedAt: now,
    })),
    projectPath
  );
}

/** Strategy C: safety cap leaving room for argv overhead (96KB hard limit). */
const MAX_CODE_REF_PROMPT_BYTES = 70_000;
/** Strategy B: max turn-context entries rendered per unique file path. */
const MAX_ENTRIES_PER_PATH = 3;
/** Strategy D: max entries per LLM batch call. */
const BATCH_SIZE = 30;

function buildCodeRefDescriptionPrompt(entries: FileEntry[]): string {
  const headerLines = [
    "Below are code file paths and the context in which they were modified. Generate a short description (<=60 chars) for each file under each distinct topic.",
    "",
    "Goal: describe what code change this file carries or what implementation role it plays under the given topic. Do NOT narrate the conversation.",
    "",
    "Rules:",
    "- Description must be <=60 chars",
    "- Prioritize the topic and code snippet; fall back to user query / assistant summary only when no snippet is available",
    '- Focus on the file\'s code responsibility or change, e.g. "add hierarchical rebuild entry for snapshot merge"',
    "- Do NOT reproduce user requests, assistant promises, or debugging steps",
    "- When the same file has multiple distinct topics, generate one description per topic",
    '- Output ONLY a JSON array: [{"path":"...","description":"..."}]',
    "- No markdown / explanations / ```",
    "",
  ];
  const header = headerLines.join("\n");

  // Group entries by path so the LLM sees all contexts for each file together
  const pathGroups = new Map<string, FileEntry[]>();
  for (const e of entries) {
    let group = pathGroups.get(e.path);
    if (!group) {
      group = [];
      pathGroups.set(e.path, group);
    }
    group.push(e);
  }

  const bodyLines: string[] = [];
  let idx = 0;
  let skippedPaths = 0;

  for (const [path, group] of pathGroups) {
    // Strategy C: stop adding when prompt would exceed byte cap
    if (
      Buffer.byteLength(header + "\n" + bodyLines.join("\n"), "utf8") >= MAX_CODE_REF_PROMPT_BYTES
    ) {
      skippedPaths++;
      continue;
    }

    // Strategy B: limit to MAX_ENTRIES_PER_PATH turn contexts per file
    const limited = group.slice(0, MAX_ENTRIES_PER_PATH);

    // A-extra: contentSnippet shared per path — prefer "create" entry
    const snippet =
      group.find((e) => e.writeKind === "create" && e.contentSnippet)?.contentSnippet ??
      group.find((e) => e.contentSnippet)?.contentSnippet;
    const isNew = group.some((e) => e.writeKind === "create");

    for (const e of limited) {
      idx++;
      const kindLabel = isNew ? " (new file)" : "";
      bodyLines.push(`[${idx}] path: ${path}${kindLabel}`);
      // A-extra: show actual written code instead of indirect query/summary
      if (snippet) {
        const snip = snippet.replace(/\s+/g, " ").slice(0, 300);
        bodyLines.push(`    code snippet: ${snip}`);
      }
      if (e.topicContexts?.length) {
        for (const ctx of e.topicContexts.slice(0, 3)) {
          bodyLines.push(`    topic: ${ctx}`);
        }
      }
      if (!snippet) {
        // Only include query/summary when there's no code snippet to avoid prompt bloat
        if (e.query) {
          const q = e.query.length > 200 ? e.query.slice(0, 197) + "..." : e.query;
          bodyLines.push(`    user query: ${q}`);
        }
        if (e.summary) {
          const s = e.summary.length > 200 ? e.summary.slice(0, 197) + "..." : e.summary;
          bodyLines.push(`    assistant summary: ${s}`);
        }
      }
    }
  }

  if (skippedPaths > 0) {
    bodyLines.push(`[...${skippedPaths} file(s) omitted due to prompt size limit...]`);
  }

  return header + "\n" + bodyLines.join("\n");
}

const CODE_REF_DESC_PROMPT_VERSION = 4;

const MAX_DESC_LEN = 60;

type DescEntry = { path: string; description: string };

function fallbackDescription(entry: FileEntry): string {
  const topic = entry.topicContexts?.[0]?.split("\uff1a")[0]?.trim();
  const base = topic ? `support ${topic} code change` : "support code change";
  return base.length > MAX_DESC_LEN ? base.slice(0, MAX_DESC_LEN - 3) + "..." : base;
}

/** Validate the description array from the small LLM call. */
function validateDescArray(value: unknown): DescEntry[] {
  if (!Array.isArray(value)) {
    // Try to extract from an object wrapper
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["items", "descriptions", "codeReferences", "entries", "results"]) {
        if (Array.isArray(obj[key])) {
          return validateDescArray(obj[key]);
        }
      }
    }
    return [];
  }
  const out: DescEntry[] = [];
  const seen = new Set<string>(); // "path\0description" dedup
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const obj = item as Record<string, unknown>;
    const p = typeof obj.path === "string" ? obj.path.trim() : "";
    const d = typeof obj.description === "string" ? obj.description.trim() : "";
    if (!p || !d) {
      continue;
    }
    const desc = d.length > MAX_DESC_LEN ? d.slice(0, MAX_DESC_LEN - 3) + "..." : d;
    const key = `${p}\0${desc}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ path: p, description: desc });
    if (out.length >= 50) {
      break;
    }
  }
  return out;
}

/**
 * Run one LLM batch call for a slice of entries.
 * Strategy D: called repeatedly for each chunk.
 */
async function runDescBatch(
  entries: FileEntry[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: { model?: string; timeoutMs?: number; cacheDir?: string; cache?: boolean },
  progress?: MindMapProgress
): Promise<DescEntry[]> {
  const prompt = buildCodeRefDescriptionPrompt(entries);
  return runLlmStage(
    {
      stageId: "code-ref-descriptions",
      promptVersion: CODE_REF_DESC_PROMPT_VERSION,
      events: [],
      prompt,
      modelHint: opts?.model,
      cacheDir: opts?.cacheDir,
      cache: opts?.cache ?? false,
      responseSchema: "code-ref-descriptions",
      maxTopics: 50,
      maxItemsPerTopic: 1,
      heartbeatMessage: "Generating code reference descriptions...",
      validate: validateDescArray,
      timeoutMs: opts?.timeoutMs,
    },
    provider,
    signal,
    progress
  );
}

/** Generate codeReference descriptions via a small LLM call (with batching). */
export async function generateCodeReferenceDescriptions(
  entries: FileEntry[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: { model?: string; timeoutMs?: number; cacheDir?: string; cache?: boolean },
  progress?: MindMapProgress
): Promise<CodeReference[]> {
  if (!entries.length) {
    return [];
  }

  // Strategy D: split into batches and merge
  const allDescs: DescEntry[] = [];
  for (let start = 0; start < entries.length; start += BATCH_SIZE) {
    const batch = entries.slice(start, start + BATCH_SIZE);
    const batchDescs = await runDescBatch(batch, provider, signal, opts, progress);
    allDescs.push(...batchDescs);
  }

  if (!allDescs.length) {
    // Fallback: use topic-shaped wording instead of transcript excerpts.
    return buildFallbackReferences(entries);
  }

  // Build descMap: path -> descriptions (ordered)
  const descMap = new Map<string, string[]>();
  for (const d of allDescs) {
    let arr = descMap.get(d.path);
    if (!arr) {
      arr = [];
      descMap.set(d.path, arr);
    }
    arr.push(d.description);
  }

  // Match entries to descriptions, collecting turn indices per (path, description)
  const acc = new Map<string, { path: string; desc: string; turns: number[] }>();
  const usedDescs = new Map<string, number>(); // path -> next description index
  for (const entry of entries) {
    const pathDescs = descMap.get(entry.path);
    let desc: string;
    if (!pathDescs?.length) {
      desc = fallbackDescription(entry);
    } else {
      const idx = usedDescs.get(entry.path) ?? 0;
      desc = idx < pathDescs.length ? pathDescs[idx] : pathDescs[pathDescs.length - 1];
      usedDescs.set(entry.path, idx + 1);
    }
    const key = `${entry.path}\0${desc}`;
    let g = acc.get(key);
    if (!g) {
      g = { path: entry.path, desc, turns: [] };
      acc.set(key, g);
    }
    g.turns.push(entry.turnIndex);
  }

  return [...acc.values()].map((g) => ({
    path: g.path,
    lines: "-",
    description: g.desc,
    sourceTurnIndices: g.turns,
  }));
}

/** Extract codeReferences from ChatEvents using a small LLM call for descriptions. */
export async function extractCodeReferencesFromEvents(
  events: ChatEvent[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: {
    projectPath?: string;
    model?: string;
    timeoutMs?: number;
    cacheDir?: string;
    cache?: boolean;
    outline?: SessionOutline;
  },
  progress?: MindMapProgress
): Promise<CodeReference[]> {
  const entries = extractFilePathsFromEvents(events, opts?.projectPath, opts?.outline);
  if (!entries.length) {
    return [];
  }
  const refs = await generateCodeReferenceDescriptions(
    entries,
    provider,
    signal,
    {
      model: opts?.model,
      timeoutMs: opts?.timeoutMs,
      cacheDir: opts?.cacheDir,
      cache: opts?.cache,
    },
    progress
  );
  return filterProjectCodeReferences(refs, opts?.projectPath);
}
