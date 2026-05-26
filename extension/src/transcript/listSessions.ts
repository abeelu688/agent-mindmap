import * as fs from "fs/promises";
import * as path from "path";
import { loadComposerTitles } from "./composerTitles";
import { extractUserQuery } from "./parseJsonl";
import type { TranscriptSession } from "./types";

async function exists(dir: string): Promise<boolean> {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

export type ListSessionsContext = {
  projectSlug?: string;
  projectPath?: string;
};

const PREVIEW_MAX_LEN = 40;
const PREVIEW_READ_BYTES = 8 * 1024;

/**
 * Peek at the first ~8KB of a transcript jsonl and return a short preview of
 * the first user query — used as a fallback when Cursor's sidebar title is
 * unavailable. Returns `undefined` if no usable user query is found in the
 * peeked region.
 */
async function readFirstUserQueryPreview(
  filePath: string,
  maxLen = PREVIEW_MAX_LEN
): Promise<string | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const buffer = Buffer.alloc(PREVIEW_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, PREVIEW_READ_BYTES, 0);
    if (!bytesRead) {
      return undefined;
    }
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    // Walk newline-delimited rows until we find a user message with text.
    // The last line may be truncated (partial JSON) — we just skip parse errors.
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let row: {
        role?: string;
        message?: {
          content?: { type?: string; text?: string }[];
        };
      };
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (row.role !== "user") {
        continue;
      }
      const parts = row.message?.content ?? [];
      for (const part of parts) {
        if (part.type !== "text" || typeof part.text !== "string") {
          continue;
        }
        const query = extractUserQuery(part.text);
        if (!query) {
          continue;
        }
        return shortenPreview(query, maxLen);
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function shortenPreview(text: string, maxLen: number): string {
  // Collapse whitespace and take the first non-empty line for tidy display.
  const firstLine =
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? text.trim();
  const collapsed = firstLine.replace(/\s+/g, " ");
  if (collapsed.length <= maxLen) {
    return collapsed;
  }
  return collapsed.slice(0, maxLen - 1) + "…";
}

export async function listSessions(
  transcriptsDir: string,
  ctx: ListSessionsContext = {}
): Promise<TranscriptSession[]> {
  if (!(await exists(transcriptsDir))) {
    return [];
  }

  const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
  const titles = await loadComposerTitles();
  const sessions: TranscriptSession[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const id = entry.name;
    const filePath = path.join(transcriptsDir, id, `${id}.jsonl`);
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }
      const mtime = stat.mtimeMs;
      const date = new Date(mtime).toLocaleString();
      const title =
        titles.get(id) ??
        (await readFirstUserQueryPreview(filePath)) ??
        `${id.slice(0, 8)}…`;
      sessions.push({
        id,
        filePath,
        mtimeMs: mtime,
        label: `${title} · ${date}`,
        projectSlug: ctx.projectSlug,
        projectPath: ctx.projectPath,
      });
    } catch {
      // skip missing jsonl
    }
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

export async function readSessionFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}
