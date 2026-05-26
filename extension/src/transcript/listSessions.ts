import * as fs from "fs/promises";
import * as path from "path";
import type { TranscriptSession } from "./types";

async function exists(dir: string): Promise<boolean> {
  try {
    await fs.access(dir);
    return true;
  } catch {
    return false;
  }
}

export async function listSessions(
  transcriptsDir: string
): Promise<TranscriptSession[]> {
  if (!(await exists(transcriptsDir))) {
    return [];
  }

  const entries = await fs.readdir(transcriptsDir, { withFileTypes: true });
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
      sessions.push({
        id,
        filePath,
        mtimeMs: mtime,
        label: `${id.slice(0, 8)}… · ${date}`,
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
