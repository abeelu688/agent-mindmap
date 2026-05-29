import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { LlmProviderId } from "../llm/types";

export type EvalPromptParams = {
  maxTopics: number;
  maxItemsPerTopic: number;
};

export type EvalConfig = {
  useFixtureTranscripts: boolean;
  fixtureSet: string;
  projectSlug: string;
  projectPath: string;
  sessionFilter: "all" | string[];
  llmProvider: LlmProviderId;
  promptParams: EvalPromptParams;
  writeReport: boolean;
  compareBaseline: boolean;
  /** Read analyzed SessionRecords from store instead of re-running LLM. */
  useStoreRecords?: boolean;
  /** Override ~/.agent-mindmap when useStoreRecords is true. */
  storeDir?: string;
  /** Override ~/.cursor/projects when useFixtureTranscripts is false. */
  projectsDir?: string;
};

export type EvalPaths = {
  repoRoot: string;
  evalDir: string;
  fixtureRoot: string;
  transcriptsDir: string;
  manifestPath: string;
  reportsDir: string;
  baselinePath: string;
  localConfigPath: string;
};

const DEFAULT_CONFIG: EvalConfig = {
  useFixtureTranscripts: true,
  fixtureSet: "aosp14",
  projectSlug: "home-example-cursor-aosp14",
  projectPath: "/home/example/cursor/aosp14",
  sessionFilter: "all",
  llmProvider: "cursor-cli",
  promptParams: { maxTopics: 12, maxItemsPerTopic: 6 },
  writeReport: true,
  compareBaseline: true,
  useStoreRecords: false,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeConfig(base: EvalConfig, patch: Record<string, unknown>): EvalConfig {
  const out: EvalConfig = { ...base };
  if (typeof patch.useFixtureTranscripts === "boolean") {
    out.useFixtureTranscripts = patch.useFixtureTranscripts;
  }
  if (typeof patch.fixtureSet === "string" && patch.fixtureSet.trim()) {
    out.fixtureSet = patch.fixtureSet.trim();
  }
  if (typeof patch.projectSlug === "string" && patch.projectSlug.trim()) {
    out.projectSlug = patch.projectSlug.trim();
  }
  if (typeof patch.projectPath === "string" && patch.projectPath.trim()) {
    out.projectPath = patch.projectPath.trim();
  }
  if (patch.sessionFilter === "all" || Array.isArray(patch.sessionFilter)) {
    out.sessionFilter = patch.sessionFilter;
  }
  if (patch.llmProvider === "cursor-cli" || patch.llmProvider === "claude-cli") {
    out.llmProvider = patch.llmProvider;
  }
  if (isObject(patch.promptParams)) {
    const pp = patch.promptParams;
    out.promptParams = {
      maxTopics:
        typeof pp.maxTopics === "number" ? pp.maxTopics : out.promptParams.maxTopics,
      maxItemsPerTopic:
        typeof pp.maxItemsPerTopic === "number"
          ? pp.maxItemsPerTopic
          : out.promptParams.maxItemsPerTopic,
    };
  }
  if (typeof patch.writeReport === "boolean") {
    out.writeReport = patch.writeReport;
  }
  if (typeof patch.compareBaseline === "boolean") {
    out.compareBaseline = patch.compareBaseline;
  }
  if (typeof patch.useStoreRecords === "boolean") {
    out.useStoreRecords = patch.useStoreRecords;
  }
  if (typeof patch.storeDir === "string") {
    out.storeDir = patch.storeDir.trim() || undefined;
  }
  if (typeof patch.projectsDir === "string") {
    out.projectsDir = patch.projectsDir.trim() || undefined;
  }
  return out;
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function resolveEvalPaths(repoRoot: string, config: EvalConfig): EvalPaths {
  const evalDir = path.join(repoRoot, "test", "eval");
  const fixtureRoot = path.join(repoRoot, "test", "fixtures", config.fixtureSet);
  return {
    repoRoot,
    evalDir,
    fixtureRoot,
    transcriptsDir: path.join(fixtureRoot, "transcripts"),
    manifestPath: path.join(fixtureRoot, "manifest.json"),
    reportsDir: path.join(evalDir, "reports"),
    baselinePath: path.join(evalDir, "baselines", "concept-trie.json"),
    localConfigPath: path.join(evalDir, "eval.config.local.json"),
  };
}

export function resolveLiveTranscriptsDir(config: EvalConfig): string {
  const projectsRoot =
    config.projectsDir?.replace(/^~(?=\/|$)/, os.homedir()) ??
    path.join(os.homedir(), ".cursor", "projects");
  return path.join(projectsRoot, config.projectSlug, "agent-transcripts");
}

export function resolveStoreDir(config: EvalConfig): string {
  const raw = config.storeDir?.trim();
  if (!raw) {
    return path.join(os.homedir(), ".agent-mindmap");
  }
  if (raw === "~") {
    return os.homedir();
  }
  if (raw.startsWith("~/")) {
    return path.join(os.homedir(), raw.slice(2));
  }
  return raw;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadEvalConfig(repoRoot: string): Promise<{
  config: EvalConfig;
  paths: EvalPaths;
}> {
  const paths = resolveEvalPaths(repoRoot, DEFAULT_CONFIG);
  const examplePath = path.join(paths.evalDir, "eval.config.example.json");
  const example = (await readJsonFile(examplePath)) ?? {};
  const local = (await readJsonFile(paths.localConfigPath)) ?? {};
  const config = mergeConfig(mergeConfig(DEFAULT_CONFIG, example), local);
  const resolved = resolveEvalPaths(repoRoot, config);

  if (config.useFixtureTranscripts) {
    if (!(await pathExists(resolved.transcriptsDir))) {
      throw new Error(
        `Fixture transcripts dir missing: ${resolved.transcriptsDir} (run npm run eval:fixtures:export)`
      );
    }
    if (!(await pathExists(resolved.manifestPath))) {
      throw new Error(`Fixture manifest missing: ${resolved.manifestPath}`);
    }
  }

  return { config, paths: resolved };
}

export function filterSessionIds(
  config: EvalConfig,
  manifestSessionIds: string[]
): string[] {
  if (config.sessionFilter === "all") {
    return manifestSessionIds;
  }
  const allowed = new Set(config.sessionFilter);
  return manifestSessionIds.filter((id) => allowed.has(id));
}
