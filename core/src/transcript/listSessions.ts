import * as fs from "fs/promises";
import * as path from "path";
import { extractUserQuery } from "./parseJsonl";
import type { AgentHostId } from "@agent-mindmap/shared";
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
  hostId?: AgentHostId;
  /** Pre-loaded id → title map (Cursor composer DB or Claude sessions-index). */
  titles?: Map<string, string>;
  /** Subdirectory names to skip when scanning flat layouts (Claude). */
  skipDirNames?: Set<string>;
  /** Skip top-level jsonl files matching these patterns (Claude sidechains). */
  skipFilePatterns?: RegExp[];
};

const PREVIEW_MAX_LEN = 40;
const PREVIEW_READ_BYTES = 8 * 1024;

const ENTRYPOINT_READ_BYTES = 64 * 1024;

/**
 * Check whether a transcript is a headless SDK/CLI call (not a real user
 * conversation). Claude Code records `--print` / SDK calls as sessions with
 * `entrypoint: "sdk-cli"` — these are agent-mindmap's own LLM calls and
 * should not be analysed as user conversations.
 *
 * Returns true if the transcript should be skipped.
 */
async function isHeadlessSdkSession(filePath: string): Promise<boolean> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "r");
    // Read up to 64KB — queue-operation lines (which precede the user line
    // with entrypoint) can be >8KB each, so 8KB is insufficient.
    const buffer = Buffer.alloc(ENTRYPOINT_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, ENTRYPOINT_READ_BYTES, 0);
    if (!bytesRead) {
      return false;
    }
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let row: { entrypoint?: string };
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (row.entrypoint === "sdk-cli") {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Peek at the first ~8KB of a transcript jsonl and return a short preview of
 * the first user query — used as a fallback when sidebar titles are unavailable.
 */
export async function readFirstUserQueryPreview(
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
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let row: {
        type?: string;
        role?: string;
        aiTitle?: string;
        message?: {
          role?: string;
          content?: { type?: string; text?: string }[] | string;
        };
      };
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }
      // Claude Code stores title in type="ai-title" rows
      if (row.type === "ai-title" && row.aiTitle?.trim()) {
        return shortenPreview(row.aiTitle.trim(), maxLen);
      }
      const isUser = row.role === "user" || row.type === "user" || row.message?.role === "user";
      if (!isUser) {
        continue;
      }
      const rawContent = row.message?.content;
      if (typeof rawContent === "string" && rawContent.trim()) {
        const query = extractUserQuery(rawContent);
        if (query) {
          return shortenPreview(query, maxLen);
        }
      }
      const parts = Array.isArray(rawContent) ? rawContent : [];
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

/** Cursor: `agent-transcripts/<id>/<id>.jsonl` */
export async function listCursorSessions(
  transcriptsDir: string,
  ctx: ListSessionsContext = {}
): Promise<TranscriptSession[]> {
  if (!(await exists(transcriptsDir))) {
    return [];
  }

  const titles = ctx.titles ?? new Map();
  const sessions: TranscriptSession[] = [];

  const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
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
        titles.get(id) ?? (await readFirstUserQueryPreview(filePath)) ?? `${id.slice(0, 8)}…`;
      sessions.push({
        id,
        filePath,
        mtimeMs: mtime,
        label: `${title} · ${date}`,
        hostId: ctx.hostId ?? "cursor",
        projectSlug: ctx.projectSlug,
        projectPath: ctx.projectPath,
      });
    } catch {
      // skip missing/unreadable jsonl
    }
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

/** Claude Code: flat `*.jsonl` in the project directory. */
export async function listFlatJsonlSessions(
  projectDir: string,
  ctx: ListSessionsContext = {}
): Promise<TranscriptSession[]> {
  if (!(await exists(projectDir))) {
    return [];
  }

  const titles = ctx.titles ?? new Map();
  const skipDirs = ctx.skipDirNames ?? new Set<string>();
  const skipFiles = ctx.skipFilePatterns ?? [];
  const sessions: TranscriptSession[] = [];

  const entries = await fs.readdir(projectDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue;
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    if (skipFiles.some((re) => re.test(entry.name))) {
      continue;
    }
    const id = entry.name.replace(/\.jsonl$/i, "");
    const filePath = path.join(projectDir, entry.name);
    try {
      // Skip headless SDK/CLI calls (agent-mindmap's own LLM invocations)
      if (await isHeadlessSdkSession(filePath)) {
        continue;
      }
      const stat = await fs.stat(filePath);
      const mtime = stat.mtimeMs;
      const date = new Date(mtime).toLocaleString();
      const title =
        titles.get(id) ?? (await readFirstUserQueryPreview(filePath)) ?? `${id.slice(0, 8)}…`;
      sessions.push({
        id,
        filePath,
        mtimeMs: mtime,
        label: `${title} · ${date}`,
        hostId: ctx.hostId ?? "claude-code",
        projectSlug: ctx.projectSlug,
        projectPath: ctx.projectPath,
      });
    } catch {
      // skip unreadable
    }
  }

  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions;
}

/** @deprecated Use host-specific listers via {@link getActiveHost}. */
export async function listSessions(
  transcriptsDir: string,
  ctx: ListSessionsContext = {}
): Promise<TranscriptSession[]> {
  return listCursorSessions(transcriptsDir, ctx);
}

export async function readSessionFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}
