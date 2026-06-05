import { execFile } from "child_process";
import type { LlmProviderId } from "./types";

export type ModelEntry = {
  id: string;
  label: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedCursorModels: { entries: ModelEntry[]; fetchedAt: number } | undefined;

const CLAUDE_KNOWN_MODELS: ModelEntry[] = [
  { id: "opus", label: "Opus (latest)" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "sonnet", label: "Sonnet (latest)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "haiku", label: "Haiku (latest)" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

function uniqById(entries: ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const e of entries) {
    if (e.id && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}

function parseCursorModelsOutput(stdout: string): ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = /^(.+?)\s+-\s+(.+)$/.exec(trimmed);
    if (m) {
      entries.push({ id: m[1]!.trim(), label: m[2]!.trim() });
    }
  }
  return entries;
}

function fetchCursorModels(cliPath: string): Promise<ModelEntry[]> {
  return new Promise<ModelEntry[]>((resolve) => {
    const bin = cliPath || "agent";
    execFile(bin, ["--list-models"], { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      resolve(parseCursorModelsOutput(stdout));
    });
  });
}

export async function fetchModelList(
  providerId: LlmProviderId,
  cliPath: string
): Promise<ModelEntry[]> {
  if (providerId === "claude-cli") {
    return CLAUDE_KNOWN_MODELS;
  }

  if (providerId === "cursor-cli") {
    if (
      cachedCursorModels &&
      Date.now() - cachedCursorModels.fetchedAt < CACHE_TTL_MS
    ) {
      return cachedCursorModels.entries;
    }
    const entries = await fetchCursorModels(cliPath);
    if (entries.length > 0) {
      cachedCursorModels = { entries, fetchedAt: Date.now() };
      return entries;
    }
    return [];
  }

  return [];
}

export function getCuratedModels(providerId: LlmProviderId): ModelEntry[] {
  if (providerId === "claude-cli") {
    return CLAUDE_KNOWN_MODELS;
  }
  if (providerId === "cursor-cli") {
    return [
      { id: "composer-2.5-fast", label: "Composer 2.5 Fast" },
      { id: "claude-opus-4-8-high", label: "Opus 4.8" },
      { id: "claude-4.6-sonnet-medium", label: "Sonnet 4.6" },
      { id: "gpt-5.5-medium", label: "GPT-5.5" },
      { id: "gpt-5.4-medium", label: "GPT-5.4" },
      { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro" },
    ];
  }
  return [];
}

export function clearModelCache(): void {
  cachedCursorModels = undefined;
}

export const __testing = {
  parseCursorModelsOutput,
  CLAUDE_KNOWN_MODELS,
};
