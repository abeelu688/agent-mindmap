import type { ChatEvent } from "../transcript/types";
import type { CodeReference, LlmProvider } from "./types";
import { groupTurns, toRelPath, isProjectRelativePath } from "./prompt";
import { filterProjectCodeReferences } from "./filterCodeReferences";
import { runLlmStage } from "../pipeline/llmStage";
import { LlmProviderError } from "./types";

/** A file path with the surrounding turn context for description generation. */
export type FileEntry = {
  path: string;
  turnIndex: number;
  query: string;
  summary: string;
};

/** Extract file paths and their turn context from ChatEvents (deterministic, no LLM). */
export function extractFilePathsFromEvents(
  events: ChatEvent[],
  projectPath?: string
): FileEntry[] {
  const turns = groupTurns(events);
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
      let entries = seen.get(rel);
      if (!entries) {
        entries = [];
        seen.set(rel, entries);
      }
      // Deduplicate by (path, query, summary) across all turns —
      // same file with identical context in different turns is redundant
      const already = entries.some(
        (e) => e.query === query && e.summary === summary
      );
      if (!already) {
        entries.push({
          path: rel,
          turnIndex: turn.index,
          query,
          summary,
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

function buildCodeRefDescriptionPrompt(entries: FileEntry[]): string {
  const lines: string[] = [
    "下面是代码文件路径及其在对话中被提及的不同上下文。为每个文件的每个不同功能/目的各生成一条简短描述（≤60字）。",
    "",
    "规则：",
    "- 描述必须 ≤60 字",
    "- 同一文件有多个不同上下文时，必须为每个上下文各生成一条描述",
    "- 只输出 JSON 数组，格式：[{\"path\":\"...\",\"description\":\"...\"}]",
    "- 不要输出 markdown / 解释 / ```",
    "",
  ];

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

  let idx = 0;
  for (const [path, group] of pathGroups) {
    for (const e of group) {
      idx++;
      lines.push(`[${idx}] path: ${path}`);
      if (e.query) {
        const q = e.query.length > 200 ? e.query.slice(0, 197) + "..." : e.query;
        lines.push(`    用户提问: ${q}`);
      }
      if (e.summary) {
        const s = e.summary.length > 200 ? e.summary.slice(0, 197) + "..." : e.summary;
        lines.push(`    助手摘要: ${s}`);
      }
    }
  }

  return lines.join("\n");
}

const CODE_REF_DESC_PROMPT_VERSION = 2;

const MAX_DESC_LEN = 60;

type DescEntry = { path: string; description: string };

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

/** Generate codeReference descriptions via a small LLM call. */
export async function generateCodeReferenceDescriptions(
  entries: FileEntry[],
  provider: LlmProvider,
  signal: AbortSignal,
  opts?: { model?: string; timeoutMs?: number; cacheDir?: string; cache?: boolean }
): Promise<CodeReference[]> {
  if (!entries.length) {
    return [];
  }

  const prompt = buildCodeRefDescriptionPrompt(entries);

  const descs = await runLlmStage(
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
      heartbeatMessage: "Generating code reference descriptions…",
      validate: validateDescArray,
      timeoutMs: opts?.timeoutMs,
    },
    provider,
    signal
  );

  if (!descs.length) {
    // Fallback: use query text as description, group turn indices by (path, fallback-desc)
    const groups = new Map<string, { path: string; desc: string; turns: number[] }>();
    for (const e of entries) {
      const fb = (e.query || e.summary || e.path).slice(0, MAX_DESC_LEN);
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

  // Build descMap: path → descriptions (ordered)
  const descMap = new Map<string, string[]>();
  for (const d of descs) {
    let arr = descMap.get(d.path);
    if (!arr) {
      arr = [];
      descMap.set(d.path, arr);
    }
    arr.push(d.description);
  }

  // Match entries to descriptions, collecting turn indices per (path, description)
  const acc = new Map<string, { path: string; desc: string; turns: number[] }>();
  const usedDescs = new Map<string, number>(); // path → next description index
  for (const entry of entries) {
    const pathDescs = descMap.get(entry.path);
    let desc: string;
    if (!pathDescs?.length) {
      desc = (entry.query || entry.summary || entry.path).slice(0, MAX_DESC_LEN);
    } else {
      const idx = usedDescs.get(entry.path) ?? 0;
      desc = idx < pathDescs.length
        ? pathDescs[idx]
        : pathDescs[pathDescs.length - 1];
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
  opts?: { projectPath?: string; model?: string; timeoutMs?: number; cacheDir?: string; cache?: boolean }
): Promise<CodeReference[]> {
  const entries = extractFilePathsFromEvents(events, opts?.projectPath);
  if (!entries.length) {
    return [];
  }
  const refs = await generateCodeReferenceDescriptions(entries, provider, signal, {
    model: opts?.model,
    timeoutMs: opts?.timeoutMs,
    cacheDir: opts?.cacheDir,
    cache: opts?.cache,
  });
  return filterProjectCodeReferences(refs, opts?.projectPath);
}
