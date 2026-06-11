import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { agentDebugLog } from "../debugLog";
import { getStoreDir } from "../paths";
import { mindMapLog } from "../webview/MindMapLog";
import type { LlmDumpMeta, LlmErrorCode, LlmResponseSchema } from "./types";
import { LlmProviderError } from "./types";

/** Visible folder name (no leading dot — easier to find in the workspace tree). */
export const LLM_DUMP_FOLDER = "agent-mindmap-llm-dumps";

export type LlmDumpSource =
  | "live-cli"
  | "llm-cache"
  | "library-cache"
  | "ontology-cache"
  | "skipped";

let loggedDumpRoots = false;

export function dumpDirForWorkspace(workspaceRoot: string): string {
  return path.join(workspaceRoot, LLM_DUMP_FOLDER);
}

export function isLlmDumpEnabled(): boolean {
  return (
    vscode.workspace
      .getConfiguration("agentMindmap")
      .get<boolean>("llm.dumpIo", true) ?? true
  );
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** All directories that receive LLM IO dumps (storeDir always; workspace when open). */
export function resolveLlmDumpRoots(): string[] {
  // TEMP: force dump to /tmp for debugging
  const forcedRoot = path.join(os.tmpdir(), "agent-mindmap-llm-dumps");
  return [forcedRoot];
}

/** @deprecated Prefer resolveLlmDumpRoots; first root or undefined when disabled. */
export function resolveLlmDumpDir(): string | undefined {
  const roots = resolveLlmDumpRoots();
  return roots[0];
}

export function logLlmDumpLocationsOnce(): void {
  if (loggedDumpRoots || !isLlmDumpEnabled()) {
    return;
  }
  loggedDumpRoots = true;
  const roots = resolveLlmDumpRoots();
  if (!roots.length) {
    return;
  }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  mindMapLog(
    `LLM dumps enabled → ${roots.join(" | ")}` +
      (ws ? ` (current workspace: ${ws})` : "")
  );
}

function compactTimestamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export type LlmIoDumpPayload = {
  stageId: string;
  responseSchema: LlmResponseSchema;
  providerId: string;
  model?: string;
  prompt: string;
  stdout: string;
  stderr?: string;
  parsed?: unknown;
  error?: { code: LlmErrorCode | string; message: string };
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  sessionId?: string;
  projectSlug?: string;
  source?: LlmDumpSource;
  skipReason?: string;
  /** Test override: write under this single root only. */
  dumpRoot?: string;
};

async function writeLlmIoDumpToRoot(
  root: string,
  payload: LlmIoDumpPayload,
  dirName: string
): Promise<string> {
  const outDir = path.join(root, payload.stageId, dirName);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "prompt.txt"), payload.prompt, "utf8");
  await fs.writeFile(path.join(outDir, "stdout.txt"), payload.stdout, "utf8");
  if (payload.stderr?.trim()) {
    await fs.writeFile(path.join(outDir, "stderr.txt"), payload.stderr, "utf8");
  }
  if (payload.parsed !== undefined) {
    await fs.writeFile(
      path.join(outDir, "parsed.json"),
      JSON.stringify(payload.parsed, null, 2),
      "utf8"
    );
  }
  if (payload.error) {
    await fs.writeFile(
      path.join(outDir, "error.json"),
      JSON.stringify(payload.error, null, 2),
      "utf8"
    );
  }
  const meta = {
    ts: new Date().toISOString(),
    stageId: payload.stageId,
    responseSchema: payload.responseSchema,
    providerId: payload.providerId,
    model: payload.model ?? null,
    attempt: payload.attempt,
    maxAttempts: payload.maxAttempts,
    durationMs: Math.round(payload.durationMs),
    sessionId: payload.sessionId ?? null,
    projectSlug: payload.projectSlug ?? null,
    source: payload.source ?? "live-cli",
    skipReason: payload.skipReason ?? null,
    ok: payload.error === undefined,
  };
  await fs.writeFile(
    path.join(outDir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8"
  );
  return outDir;
}

export async function writeLlmIoDump(
  payload: LlmIoDumpPayload
): Promise<string | undefined> {
  const roots = payload.dumpRoot
    ? [payload.dumpRoot]
    : resolveLlmDumpRoots();
  agentDebugLog(
    "llmIoDump.ts:writeLlmIoDump",
    "writeLlmIoDump enter",
    {
      stageId: payload.stageId,
      source: payload.source ?? "live-cli",
      sessionId: payload.sessionId ?? null,
      roots,
      dumpRootOverride: payload.dumpRoot ?? null,
      promptLen: payload.prompt.length,
    },
    "B"
  );
  if (!roots.length) {
    agentDebugLog(
      "llmIoDump.ts:writeLlmIoDump",
      "skip: no dump roots",
      { stageId: payload.stageId },
      "A"
    );
    return undefined;
  }

  logLlmDumpLocationsOnce();
  const dirName = `${compactTimestamp()}-${randomSuffix()}`;
  let firstOut: string | undefined;

  for (const root of roots) {
    try {
      const outDir = await writeLlmIoDumpToRoot(root, payload, dirName);
      if (!firstOut) {
        firstOut = outDir;
      }
      mindMapLog(
        `LLM dump (${payload.source ?? "live-cli"}): ${outDir}`
      );
      agentDebugLog(
        "llmIoDump.ts:writeLlmIoDump",
        "dump write ok",
        { outDir, root, stageId: payload.stageId },
        "D"
      );
    } catch (err) {
      console.warn(`[agent-mindmap] LLM dump failed (${root}):`, err);
      agentDebugLog(
        "llmIoDump.ts:writeLlmIoDump",
        "dump write failed",
        {
          root,
          stageId: payload.stageId,
          error: err instanceof Error ? err.message : String(err),
        },
        "D"
      );
    }
  }
  agentDebugLog(
    "llmIoDump.ts:writeLlmIoDump",
    "writeLlmIoDump exit",
    { stageId: payload.stageId, firstOut: firstOut ?? null },
    "D"
  );
  return firstOut;
}

export function errorForDump(err: unknown): { code: string; message: string } {
  if (err instanceof LlmProviderError) {
    return { code: err.code, message: err.message };
  }
  if (err instanceof Error) {
    return { code: "cli-failed", message: err.message };
  }
  return { code: "cli-failed", message: String(err) };
}

/** Replay dump when no live CLI ran (library / hash cache / ontology cache). */
export async function dumpLlmReplay(opts: {
  stageId: string;
  responseSchema: LlmResponseSchema;
  providerId: string;
  model?: string;
  prompt: string;
  parsed: unknown;
  source: LlmDumpSource;
  sessionId?: string;
  projectSlug?: string;
  skipReason?: string;
  stdout?: string;
  dumpRoot?: string;
}): Promise<void> {
  // TEMP: always dump for debugging
  // if (!opts.dumpRoot && !isLlmDumpEnabled()) { return; }
  agentDebugLog(
    "llmIoDump.ts:dumpLlmReplay",
    "dumpLlmReplay enter",
    {
      stageId: opts.stageId,
      source: opts.source,
      sessionId: opts.sessionId ?? null,
    },
    "F"
  );
  await writeLlmIoDump({
    stageId: opts.stageId,
    responseSchema: opts.responseSchema,
    providerId: opts.providerId,
    model: opts.model,
    prompt: opts.prompt,
    stdout: opts.stdout ?? "",
    parsed: opts.parsed,
    attempt: 0,
    maxAttempts: 0,
    durationMs: 0,
    sessionId: opts.sessionId,
    projectSlug: opts.projectSlug,
    source: opts.source,
    skipReason: opts.skipReason,
    dumpRoot: opts.dumpRoot,
  });
}

export async function dumpLlmCallResult(opts: {
  input: {
    prompt: string;
    model?: string;
    responseSchema?: LlmResponseSchema;
    dumpMeta?: LlmDumpMeta;
  };
  providerId: string;
  stdout: string;
  stderr?: string;
  parsed?: unknown;
  error?: unknown;
  attempt: number;
  maxAttempts: number;
  durationMs: number;
  dumpRoot?: string;
}): Promise<void> {
  if (!opts.input.dumpMeta) {
    agentDebugLog(
      "llmIoDump.ts:dumpLlmCallResult",
      "skip live dump: no dumpMeta",
      {
        responseSchema: opts.input.responseSchema ?? null,
        providerId: opts.providerId,
      },
      "C"
    );
    return;
  }
  // TEMP: always dump for debugging
  // if (!opts.dumpRoot && !isLlmDumpEnabled()) { return; }
  agentDebugLog(
    "llmIoDump.ts:dumpLlmCallResult",
    "dumpLlmCallResult enter",
    {
      stageId: opts.input.dumpMeta.stageId,
      attempt: opts.attempt,
      hasParsed: opts.parsed !== undefined,
      hasError: opts.error !== undefined,
      stdoutLen: opts.stdout.length,
    },
    "C"
  );
  const stageId =
    opts.input.dumpMeta?.stageId ??
    opts.input.responseSchema ??
    "unknown";
  await writeLlmIoDump({
    stageId,
    responseSchema: opts.input.responseSchema ?? "session-outline",
    providerId: opts.providerId,
    model: opts.input.model,
    prompt: opts.input.prompt,
    stdout: opts.stdout,
    stderr: opts.stderr,
    parsed: opts.parsed,
    error: opts.error ? errorForDump(opts.error) : undefined,
    attempt: opts.attempt,
    maxAttempts: opts.maxAttempts,
    durationMs: opts.durationMs,
    sessionId: opts.input.dumpMeta?.sessionId,
    projectSlug: opts.input.dumpMeta?.projectSlug,
    source: "live-cli",
    dumpRoot: opts.dumpRoot,
  });
}

export const __testing = {
  compactTimestamp,
  randomSuffix,
  dumpDirForWorkspace,
  resolveLlmDumpRoots,
};
