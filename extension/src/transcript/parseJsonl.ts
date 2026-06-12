import type { ChatEvent } from "./types";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const REDACTED = "[REDACTED]";

type ContentPart =
  | { type: "text"; text?: string }
  | {
      type: "tool_use";
      name?: string;
      input?: Record<string, unknown> | string;
    };

type JsonlLine = {
  role?: string;
  message?: { content?: ContentPart[] };
};

export function extractUserQuery(text: string): string | undefined {
  const match = USER_QUERY_RE.exec(text);
  if (match?.[1]) {
    return match[1].trim();
  }
  const trimmed = text.trim();
  return trimmed || undefined;
}

function extractPatchFilePaths(text: string): string[] {
  const out: string[] = [];
  const re = /^\*\*\* (?:Update|Add) File:\s*(.+?)\s*$/gm;
  for (const match of text.matchAll(re)) {
    const p = match[1]?.trim();
    if (p) {
      out.push(p);
    }
  }
  return out;
}

function toolLabel(name: string, input: Record<string, unknown> | string): string {
  const n = name || "Tool";
  if (typeof input === "string") {
    const fp = extractPatchFilePaths(input)[0];
    return fp ? `${n}: ${basename(fp)}` : n;
  }
  const fp = input.file_path ?? input.path;
  if (typeof fp === "string" && fp) {
    return `${n}: ${basename(fp)}`;
  }
  const pattern = input.pattern;
  if (typeof pattern === "string" && pattern) {
    const short =
      pattern.length > 40 ? pattern.slice(0, 37) + "..." : pattern;
    return `${n}: ${short}`;
  }
  const term = input.search_term;
  if (typeof term === "string" && term) {
    return `${n}: ${term}`;
  }
  const url = input.url;
  if (typeof url === "string" && url) {
    return `${n}: ${url}`;
  }
  return n;
}

function extractFilePaths(input: Record<string, unknown> | string): string[] {
  if (typeof input === "string") {
    return extractPatchFilePaths(input);
  }
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) {
      out.push(v.trim());
    }
  };
  push(input.file_path);
  push(input.path);
  const paths = input.paths;
  if (Array.isArray(paths)) {
    for (const p of paths) {
      push(p);
    }
  }
  const edits = input.edits;
  if (Array.isArray(edits)) {
    for (const e of edits) {
      if (e && typeof e === "object") {
        push((e as Record<string, unknown>).file_path);
      }
    }
  }
  const notebook = input.notebook_path;
  push(notebook);
  const patch = input.patch ?? input.diff;
  if (typeof patch === "string") {
    out.push(...extractPatchFilePaths(patch));
  }
  return out;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

function isRedactedOrEmpty(text: string): boolean {
  const t = text.trim();
  return !t || t === REDACTED;
}

function hasToolUse(parts: ContentPart[]): boolean {
  return parts.some((p) => p.type === "tool_use");
}

function getTextParts(parts: ContentPart[]): string[] {
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => (p as { type: "text"; text: string }).text);
}

export function parseJsonl(content: string): ChatEvent[] {
  const lines = content.split("\n").filter((l) => l.trim());
  const events: ChatEvent[] = [];
  let pendingTools: ChatEvent[] = [];

  const flushTools = () => {
    events.push(...pendingTools);
    pendingTools = [];
  };

  for (let i = 0; i < lines.length; i++) {
    let row: JsonlLine;
    try {
      row = JSON.parse(lines[i]) as JsonlLine;
    } catch {
      continue;
    }

    const role = row.role;
    const parts = row.message?.content ?? [];
    if (!parts.length) {
      continue;
    }

    if (role === "user") {
      flushTools();
      const texts = getTextParts(parts);
      for (const text of texts) {
        const query = extractUserQuery(text);
        if (query && !isRedactedOrEmpty(query)) {
          events.push({ kind: "user_query", text: query, lineIndex: i });
        }
      }
      continue;
    }

    if (role === "assistant") {
      if (hasToolUse(parts)) {
        for (const part of parts) {
          if (part.type === "tool_use") {
            const name = part.name ?? "tool";
            const input = part.input ?? {};
            pendingTools.push({
              kind: "tool",
              name,
              label: toolLabel(name, input),
              lineIndex: i,
              filePaths: extractFilePaths(input),
            });
          }
        }
        continue;
      }

      const texts = getTextParts(parts).filter((t) => !isRedactedOrEmpty(t));
      if (!texts.length) {
        continue;
      }

      const combined = texts.join("\n\n").trim();
      if (!combined || combined.length < 20) {
        continue;
      }

      flushTools();

      const preview =
        combined.length > 200 ? combined.slice(0, 197) + "..." : combined;

      events.push({
        kind: "assistant_summary",
        text: combined,
        preview,
        lineIndex: i,
      });
    }
  }

  flushTools();

  return events;
}
