import { execFile } from "child_process";
import type { LlmProviderId } from "./types";

export type ModelEntry = {
  id: string;
  label: string;
};

export type DetectedCli = {
  providerId: LlmProviderId;
  /** Resolved binary name or absolute path. */
  binary: string;
  /** Display label, e.g. "Claude Code (claude)". */
  label: string;
};

export type CliProbeResult = {
  /** CLIs found on this machine. */
  available: DetectedCli[];
  /** CLIs not found (for showing install hints). */
  missing: DetectedCli[];
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
  resolveBinary,
};

// ─── CLI detection ─────────────────────────────────────────────────────────

/** Resolve a binary to an absolute path using `which` (POSIX) or `where` (Windows). */
function resolveBinary(
  binary: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | undefined> {
  const cmd = platform === "win32" ? "where" : "which";
  return new Promise<string | undefined>((resolve) => {
    execFile(cmd, [binary], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout?.trim()) {
        resolve(undefined);
        return;
      }
      // Take the first result line (where may return multiple)
      const first = stdout.trim().split(/\r?\n/)[0]!.trim();
      resolve(first || undefined);
    });
  });
}

type CliCandidate = {
  binary: string;
  providerId: LlmProviderId;
  label: string;
};

const CLI_CANDIDATES: CliCandidate[] = [
  { binary: "claude", providerId: "claude-cli", label: "Claude Code (claude)" },
  { binary: "agent", providerId: "cursor-cli", label: "Cursor Agent (agent)" },
  { binary: "cursor-agent", providerId: "cursor-cli", label: "Cursor Agent (cursor-agent)" },
];

/**
 * Detect which LLM CLIs are installed on this machine.
 *
 * @param cliPathSetting Optional user-configured `agentMindmap.llm.cliPath`.
 * @returns Available CLIs (found) and missing CLIs (not found, for UI hints).
 */
export async function detectAvailableClis(
  cliPathSetting?: string
): Promise<CliProbeResult> {
  const available: DetectedCli[] = [];
  const missing: DetectedCli[] = [];
  const seenProviders = new Set<LlmProviderId>();

  // If the user has a custom cliPath, probe it first
  if (cliPathSetting?.trim()) {
    const resolved = await resolveBinary(cliPathSetting.trim());
    // Guess provider from the binary name
    const lower = cliPathSetting.toLowerCase();
    const providerId: LlmProviderId =
      lower.includes("claude") ? "claude-cli" : "cursor-cli";
    if (resolved) {
      available.push({
        providerId,
        binary: resolved,
        label: `Custom CLI (${cliPathSetting.trim()})`,
      });
      seenProviders.add(providerId);
    }
  }

  for (const candidate of CLI_CANDIDATES) {
    // Skip if we already found a CLI for this provider
    if (seenProviders.has(candidate.providerId)) {
      continue;
    }
    const resolved = await resolveBinary(candidate.binary);
    if (resolved) {
      available.push({
        providerId: candidate.providerId,
        binary: resolved,
        label: candidate.label,
      });
      seenProviders.add(candidate.providerId);
    } else {
      // Only add one missing entry per provider
      if (!missing.some((m) => m.providerId === candidate.providerId)) {
        missing.push({
          providerId: candidate.providerId,
          binary: candidate.binary,
          label: candidate.label,
        });
      }
    }
  }

  return { available, missing };
}
