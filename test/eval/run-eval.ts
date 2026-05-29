import * as fs from "fs/promises";
import * as path from "path";
import {
  diffAgainstBaseline,
  measureConceptMerge,
  type BaselineComparable,
  type ConceptEvalReport,
} from "../../extension/src/eval/metrics";
import {
  filterSessionIds,
  loadEvalConfig,
  resolveLiveTranscriptsDir,
  resolveStoreDir,
  type EvalConfig,
  type EvalPaths,
} from "../../extension/src/eval/loadEvalConfig";
import { getProvider } from "../../extension/src/llm";
import { PROMPT_VERSION } from "../../extension/src/llm/promptOutline";
import { summarizeSession } from "../../extension/src/llm/summarizeSession";
import { parseJsonl } from "../../extension/src/transcript/parseJsonl";
import {
  listCursorSessions,
  readSessionFile,
} from "../../extension/src/transcript/listSessions";
import type { TranscriptSession } from "../../extension/src/transcript/types";
import {
  buildRecordMeta,
  buildSessionRecord,
  listRecords,
  sha256Hex,
} from "../../extension/src/store/sessionStore";
import type { SessionRecord } from "../../extension/src/store/storeTypes";

/** Repo root when bundled to `extension/dist/eval-run.js`. */
const REPO_ROOT = path.resolve(__dirname, "../..");

type FixtureManifest = {
  sessionCount: number;
  sessions: { sessionId: string }[];
};

async function readManifest(manifestPath: string): Promise<FixtureManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(raw) as FixtureManifest;
}

async function resolveTranscriptsDir(
  config: EvalConfig,
  paths: EvalPaths
): Promise<string> {
  if (config.useFixtureTranscripts) {
    return paths.transcriptsDir;
  }
  return resolveLiveTranscriptsDir(config);
}

async function loadRecordsFromStore(
  config: EvalConfig,
  sessionIds: string[]
): Promise<SessionRecord[]> {
  const storeDir = resolveStoreDir(config);
  const all = await listRecords(storeDir);
  const allowed = new Set(sessionIds);
  return all.filter(
    (r) =>
      r.meta.projectSlug === config.projectSlug && allowed.has(r.meta.sessionId)
  );
}

async function analyzeSession(
  session: TranscriptSession,
  config: EvalConfig,
  cacheDir: string
): Promise<SessionRecord> {
  const content = await readSessionFile(session.filePath);
  const events = parseJsonl(content);
  const provider = getProvider({ provider: config.llmProvider });
  const outline = await summarizeSession(
    events,
    {
      prompt: {
        maxBranches: config.promptParams.maxTopics,
        maxDetailsPerNode: config.promptParams.maxItemsPerTopic,
      },
      cache: true,
      cacheDir,
      hostId: "cursor",
    },
    provider,
    new AbortController().signal
  );
  const meta = buildRecordMeta({
    sessionId: session.id,
    projectSlug: config.projectSlug,
    projectPath: config.projectPath,
    transcriptPath: session.filePath,
    transcriptMtimeMs: session.mtimeMs,
    transcriptSha256: sha256Hex(content),
    llm: { provider: config.llmProvider },
    promptParams: config.promptParams,
    promptVersion: PROMPT_VERSION,
    sessionLabel: session.label,
    hostId: session.hostId ?? "cursor",
  });
  return buildSessionRecord(meta, outline);
}

async function loadOrAnalyzeRecords(
  config: EvalConfig,
  paths: EvalPaths,
  sessions: TranscriptSession[],
  fixtureSessionIds: string[]
): Promise<SessionRecord[]> {
  if (config.useStoreRecords) {
    const fromStore = await loadRecordsFromStore(config, fixtureSessionIds);
    if (fromStore.length !== fixtureSessionIds.length) {
      const found = new Set(fromStore.map((r) => r.meta.sessionId));
      const missing = fixtureSessionIds.filter((id) => !found.has(id));
      console.warn(
        `useStoreRecords: missing ${missing.length} records: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`
      );
    }
    return fromStore;
  }

  const cacheDir = path.join(paths.evalDir, ".cache", "llm-outline");
  await fs.mkdir(cacheDir, { recursive: true });
  const records: SessionRecord[] = [];
  let i = 0;
  for (const session of sessions) {
    i += 1;
    console.log(`[${i}/${sessions.length}] Analyzing ${session.id.slice(0, 8)}…`);
    records.push(await analyzeSession(session, config, cacheDir));
  }
  return records;
}

function pickComparable(report: ConceptEvalReport): BaselineComparable {
  return {
    conceptMerge: {
      trieNodeCount: report.conceptMerge.trieNodeCount,
      mindMapNodeCount: report.conceptMerge.mindMapNodeCount,
      totalTopics: report.conceptMerge.totalTopics,
      topicsWithPath: report.conceptMerge.topicsWithPath,
      topicsWithoutPath: report.conceptMerge.topicsWithoutPath,
      rootChildren: report.conceptMerge.rootChildren,
    },
    coverage: {
      sessionCoverageRate: report.coverage.sessionCoverageRate,
      sessionsAtTerminalTopics: report.coverage.sessionsAtTerminalTopics,
      sessionsInAnyTopic: report.coverage.sessionsInAnyTopic,
    },
  };
}

export async function runEval(repoRoot = REPO_ROOT): Promise<number> {
  let config;
  let paths;
  try {
    ({ config, paths } = await loadEvalConfig(repoRoot));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return 1;
  }

  let fixtureSessionIds: string[];
  if (config.useFixtureTranscripts) {
    const manifest = await readManifest(paths.manifestPath);
    fixtureSessionIds = manifest.sessions.map((s) => s.sessionId);
  } else {
    const transcriptsDir = await resolveTranscriptsDir(config, paths);
    const listed = await listCursorSessions(transcriptsDir, {
      projectSlug: config.projectSlug,
      projectPath: config.projectPath,
      hostId: "cursor",
    });
    fixtureSessionIds = listed.map((s) => s.id);
  }

  const targetIds = filterSessionIds(config, fixtureSessionIds);
  const transcriptsDir = await resolveTranscriptsDir(config, paths);
  const allSessions = await listCursorSessions(transcriptsDir, {
    projectSlug: config.projectSlug,
    projectPath: config.projectPath,
    hostId: "cursor",
  });
  const sessions = allSessions.filter((s) => targetIds.includes(s.id));

  if (!sessions.length) {
    console.error("No sessions matched sessionFilter.");
    return 1;
  }

  console.log(
    `Eval: ${sessions.length} session(s), fixture=${config.useFixtureTranscripts}, store=${!!config.useStoreRecords}`
  );

  const records = await loadOrAnalyzeRecords(config, paths, sessions, targetIds);
  if (!records.length) {
    console.error("No SessionRecords to evaluate.");
    return 1;
  }

  const report = measureConceptMerge(
    records,
    { projectSlug: config.projectSlug },
    targetIds
  );

  const fullReport = {
    evaluatedAt: report.evaluatedAt,
    config: {
      useFixtureTranscripts: config.useFixtureTranscripts,
      fixtureSet: config.fixtureSet,
      projectSlug: config.projectSlug,
      useStoreRecords: config.useStoreRecords ?? false,
      sessionFilter: config.sessionFilter,
      llmProvider: config.llmProvider,
    },
    fixtureSessionCount: targetIds.length,
    analyzedSessionCount: records.length,
    conceptMerge: report.conceptMerge,
    coverage: report.coverage,
    baselineDelta: undefined as Record<string, number> | undefined,
  };

  let exitCode = 0;

  if (config.compareBaseline) {
    try {
      const baselineRaw = await fs.readFile(paths.baselinePath, "utf8");
      const baseline = JSON.parse(baselineRaw) as BaselineComparable;
      fullReport.baselineDelta = diffAgainstBaseline(report, baseline);
      const delta = fullReport.baselineDelta;
      const changed = Object.entries(delta).filter(([, v]) => v !== 0);
      if (changed.length) {
        console.log("Baseline delta:", delta);
        exitCode = 1;
      } else {
        console.log("Baseline: no changes.");
      }
    } catch {
      console.warn(`No baseline at ${paths.baselinePath} — skipping diff.`);
    }
  }

  console.log("Metrics:", {
    trieNodeCount: report.conceptMerge.trieNodeCount,
    mindMapNodeCount: report.conceptMerge.mindMapNodeCount,
    totalTopics: report.conceptMerge.totalTopics,
    sessionCoverageRate: report.coverage.sessionCoverageRate.toFixed(3),
    sessionsAtTerminalTopics: report.coverage.sessionsAtTerminalTopics,
  });

  if (config.writeReport) {
    await fs.mkdir(paths.reportsDir, { recursive: true });
    const stamp = report.evaluatedAt.replace(/[:.]/g, "-");
    const outPath = path.join(paths.reportsDir, `${stamp}.json`);
    await fs.writeFile(outPath, JSON.stringify(fullReport, null, 2) + "\n");
    console.log(`Report: ${outPath}`);
  }

  if (process.argv.includes("--write-baseline")) {
    const baseline = pickComparable(report);
    await fs.mkdir(path.dirname(paths.baselinePath), { recursive: true });
    await fs.writeFile(
      paths.baselinePath,
      JSON.stringify(
        {
          ...baseline,
          recordedAt: report.evaluatedAt,
          note: "Generated by run-eval --write-baseline",
        },
        null,
        2
      ) + "\n"
    );
    console.log(`Baseline written: ${paths.baselinePath}`);
  }

  return exitCode;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main(): Promise<void> {
  const code = await runEval();
  process.exit(code);
}
