import type { ChatEvent } from "./types";

const USER_QUERY_RE = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/i;
const REDACTED = "[REDACTED]";

type ContentPart =
  | { type: "text"; text?: string }
  | { type: "tool_use"; name?: string; input?: Record<string, unknown> }
  | { type: "tool_result"; content?: string | ContentPart[] };

type JsonlLine = {
  type?: string;
  role?: string;
  message?: { content?: ContentPart[] | string; role?: string };
};

export function extractUserQuery(text: string): string | undefined {
  const match = USER_QUERY_RE.exec(text);
  if (match?.[1]) {
    return match[1].trim();
  }
  const trimmed = text.trim();
  return trimmed || undefined;
}

function toolLabel(name: string, input: Record<string, unknown>): string {
  const n = name || "Tool";
  const p = input.path;
  if (typeof p === "string" && p) {
    return `${n}: ${basename(p)}`;
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

function normalizeContent(
  content: ContentPart[] | string | undefined
): ContentPart[] {
  if (Array.isArray(content)) {
    return content;
  }
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content }] : [];
  }
  return [];
}

export function parseClaudeJsonl(content: string): ChatEvent[] {
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

    // Only process rows with type "user" or "assistant"
    const rowType = row.type;
    if (rowType !== "user" && rowType !== "assistant") {
      continue;
    }

    const role = row.message?.role ?? row.role;
    const parts = normalizeContent(row.message?.content);
    if (!parts.length) {
      continue;
    }

    if (role === "user") {
      // Skip tool_result-only user messages (they accompany tool_use responses)
      const hasToolResult = parts.some((p) => p.type === "tool_result");
      const textParts = getTextParts(parts);
      const hasUserText = textParts.some((t) => !isRedactedOrEmpty(t));

      if (hasUserText) {
        flushTools();
        for (const text of textParts) {
          const query = extractUserQuery(text);
          if (query && !isRedactedOrEmpty(query)) {
            events.push({ kind: "user_query", text: query, lineIndex: i });
          }
        }
      } else if (hasToolResult) {
        // tool_result is not a user query; skip
      }
      continue;
    }

    if (role === "assistant") {
      if (hasToolUse(parts)) {
        for (const part of parts) {
          if (part.type === "tool_use") {
            const name = (part as { type: "tool_use"; name?: string }).name ?? "tool";
            const input =
              (part as { type: "tool_use"; input?: Record<string, unknown> })
                .input ?? {};
            pendingTools.push({
              kind: "tool",
              name,
              label: toolLabel(name, input),
              lineIndex: i,
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
