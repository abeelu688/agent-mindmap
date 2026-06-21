import * as fs from "fs";
import { execFileSync } from "child_process";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { SqliteStore, type SessionRecord } from "../shared/src";

// Mock getActiveHost so runRekeyMigration doesn't go through real host resolution
// (which would need vscode.env.appName / showQuickPick). The slugDerivation
// module's checkRepoPrerequisites + normalizeRepoUriToSlug are left REAL so we
// exercise real git against temp repos.

const hostMock = {
  encodeWorkspacePath: (fsPath: string) => fsPath.replace(/^\//, "").replace(/\//g, "-"),
};

vi.mock("../extension/src/host", () => ({
  getActiveHost: async () => hostMock,
}));

// vi.mock is hoisted; top-level await import picks up the mocked graph.
const { runRekeyMigration, isStoreRekeyedToRepo, REKEY_FLAG_KEY } =
  await import("../extension/src/store/rekeyMigration");

const vscodeAny = vscode as any;

function gitInit(dir: string, originUrl?: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  if (originUrl) {
    execFileSync("git", ["remote", "add", "origin", originUrl], { cwd: dir, stdio: "ignore" });
  }
}

function sampleRecord(projectSlug: string, sessionId: string, codeRefPath?: string): SessionRecord {
  return {
    schemaVersion: 1,
    meta: {
      sessionId,
      projectSlug,
      projectPath: `/home/user/${projectSlug}`,
      transcriptPath: `/tmp/${sessionId}.jsonl`,
      transcriptMtimeMs: 1,
      analyzedAt: 1000,
      llm: { provider: "cursor-cli" },
      promptParams: { maxTopics: 8, maxItemsPerTopic: 6 },
      sessionLabel: `Session ${sessionId}`,
    },
    outline: {
      title: `Title ${sessionId}`,
      summary: "summary",
      outline: [
        {
          title: "topic",
          summary: "s",
          details: [{ text: "d" }],
        },
      ],
    },
    conceptContexts: [],
    codeReferences: codeRefPath
      ? [
          {
            path: codeRefPath,
            lines: "1-10",
            description: "ref",
          },
        ]
      : undefined,
  };
}

// ─── SqliteStore.rekeyProjectSlug (SQL primitive) ─────────────────────────

describe("SqliteStore.rekeyProjectSlug", () => {
  let tmp: string;
  let dbPath: string;
  let store: SqliteStore;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "amm-rekey-sql-"));
    dbPath = path.join(tmp, "store.db");
    store = new SqliteStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("moves all sessions from old slug to new slug and preserves record_json verbatim", async () => {
    await store.upsertRecord(sampleRecord("home-user-proj", "s1", "src/foo.ts"));
    await store.upsertRecord(sampleRecord("home-user-proj", "s2", "src/bar.ts"));

    await store.rekeyProjectSlug("home-user-proj", "org/repo.git");

    expect(await store.listRecordsForProject("home-user-proj")).toEqual([]);
    const rekeyed = await store.listRecordsForProject("org/repo.git");
    expect(rekeyed.map((r) => r.meta.sessionId).sort()).toEqual(["s1", "s2"]);
    // CodeReference.path unchanged (byte-identical record_json copy).
    const paths = rekeyed
      .flatMap((r) => r.codeReferences ?? [])
      .map((c) => c.path)
      .sort();
    expect(paths).toEqual(["src/bar.ts", "src/foo.ts"]);
  });

  it("preserves project revision + record_count under the new slug", async () => {
    await store.upsertRecord(sampleRecord("home-user-proj", "s1"));
    await store.upsertRecord(sampleRecord("home-user-proj", "s2"));
    const oldRevision = await store.getProjectRevision("home-user-proj");

    await store.rekeyProjectSlug("home-user-proj", "org/repo.git");

    expect(await store.getProjectRevision("org/repo.git")).toBe(oldRevision);
    expect(await store.getProjectRecordCount("org/repo.git")).toBe(2);
    expect(await store.getProjectRevision("home-user-proj")).toBe(0);
  });

  it("is a no-op when oldSlug has no sessions", async () => {
    await store.upsertRecord(sampleRecord("other-slug", "s1"));
    await store.rekeyProjectSlug("home-user-proj", "org/repo.git");
    expect(await store.listRecordsForProject("org/repo.git")).toEqual([]);
    expect(await store.listRecordsForProject("other-slug")).toHaveLength(1);
  });

  it("is a no-op when oldSlug === newSlug", async () => {
    await store.upsertRecord(sampleRecord("home-user-proj", "s1"));
    await store.rekeyProjectSlug("home-user-proj", "home-user-proj");
    expect(await store.listRecordsForProject("home-user-proj")).toHaveLength(1);
  });

  it("partial rekey via sessionIds moves only those sessions and keeps old project row", async () => {
    await store.upsertRecord(sampleRecord("home-user-proj", "s1"));
    await store.upsertRecord(sampleRecord("home-user-proj", "s2"));

    await store.rekeyProjectSlug("home-user-proj", "org/repo.git", ["s1"]);

    expect(await store.listRecordsForProject("org/repo.git")).toHaveLength(1);
    // Old slug still has s2 and its project row (FK target intact).
    expect(await store.listRecordsForProject("home-user-proj")).toHaveLength(1);
    expect(await store.getProjectRevision("home-user-proj")).toBeGreaterThan(0);
  });
});

// ─── runRekeyMigration orchestration ──────────────────────────────────────

describe("runRekeyMigration", () => {
  let tmpRoot: string;
  let storeDir: string;
  let originalGetConfiguration: unknown;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-rekey-"));
    storeDir = path.join(tmpRoot, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    originalGetConfiguration = vscodeAny.workspace.getConfiguration;
    vscodeAny.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue: unknown) => (key === "storeDir" ? storeDir : defaultValue),
    });
    vscodeAny.workspace.workspaceFolders = undefined;
  });

  afterEach(() => {
    vscodeAny.workspace.getConfiguration = originalGetConfiguration;
    vscodeAny.workspace.workspaceFolders = undefined;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function setFolders(folders: { fsPath: string }[]): void {
    vscodeAny.workspace.workspaceFolders = folders.map((f) => ({
      uri: { fsPath: f.fsPath },
    }));
  }

  async function openStore(): Promise<SqliteStore> {
    const s = new SqliteStore(path.join(storeDir, "store.db"));
    await s.listProjectSummaries(); // force open
    return s;
  }

  it("aborts when any workspace folder fails repo prerequisites (no backup, no writes)", async () => {
    const valid = path.join(tmpRoot, "valid");
    const nogit = path.join(tmpRoot, "nogit");
    gitInit(valid, "https://github.com/org/repo.git");
    fs.mkdirSync(nogit, { recursive: true });
    setFolders([{ fsPath: valid }, { fsPath: nogit }]);

    // Pre-seed a record under the valid folder's workspace slug so we can
    // assert it survives the abort.
    const wsSlug = hostMock.encodeWorkspacePath(valid);
    const seed = await openStore();
    await seed.upsertRecord(sampleRecord(wsSlug, "s1"));
    await seed.close();

    const result = await runRekeyMigration();
    expect(result.kind).toBe("aborted");

    // No backup file, no kv flag, record still under workspace slug.
    const backups = fs.readdirSync(storeDir).filter((f) => f.startsWith("store.db.pre-rekey-"));
    expect(backups).toEqual([]);
    const verify = await openStore();
    expect(await verify.listRecordsForProject(wsSlug)).toHaveLength(1);
    expect(await verify.readMetaFlag(REKEY_FLAG_KEY)).toBe(false);
    await verify.close();
  });

  it("rekeys all folders, writes backup, sets flag, preserves CodeReference.path", async () => {
    const folderA = path.join(tmpRoot, "a");
    const folderB = path.join(tmpRoot, "b");
    gitInit(folderA, "https://github.com/org/repo-a.git");
    gitInit(folderB, "https://github.com/org/repo-b.git");
    setFolders([{ fsPath: folderA }, { fsPath: folderB }]);

    const slugA = hostMock.encodeWorkspacePath(folderA);
    const slugB = hostMock.encodeWorkspacePath(folderB);
    const seed = await openStore();
    await seed.upsertRecord(sampleRecord(slugA, "s1", "src/a.ts"));
    await seed.upsertRecord(sampleRecord(slugB, "s2", "src/b.ts"));
    await seed.close();

    const beforeStat = fs.statSync(path.join(storeDir, "store.db")).size;

    const result = await runRekeyMigration();
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.foldersRekeyed).toBe(2);
      expect(fs.existsSync(result.backupPath)).toBe(true);
    }

    const verify = await openStore();
    expect(await verify.listRecordsForProject(slugA)).toEqual([]);
    expect(await verify.listRecordsForProject(slugB)).toEqual([]);
    const aRecords = await verify.listRecordsForProject("org/repo-a.git");
    const bRecords = await verify.listRecordsForProject("org/repo-b.git");
    expect(aRecords.flatMap((r) => r.codeReferences ?? []).map((c) => c.path)).toEqual([
      "src/a.ts",
    ]);
    expect(bRecords.flatMap((r) => r.codeReferences ?? []).map((c) => c.path)).toEqual([
      "src/b.ts",
    ]);
    expect(await verify.readMetaFlag(REKEY_FLAG_KEY)).toBe(true);
    await verify.close();

    // Backup file exists and is at least as large as the pre-rekey db.
    const backups = fs.readdirSync(storeDir).filter((f) => f.startsWith("store.db.pre-rekey-"));
    expect(backups).toHaveLength(1);
    const backupSize = fs.statSync(path.join(storeDir, backups[0]!)).size;
    expect(backupSize).toBeGreaterThanOrEqual(beforeStat);
  });

  it("idempotent: second run is noop because flag is already set", async () => {
    const folder = path.join(tmpRoot, "single");
    gitInit(folder, "https://github.com/org/repo.git");
    setFolders([{ fsPath: folder }]);

    const wsSlug = hostMock.encodeWorkspacePath(folder);
    const seed = await openStore();
    await seed.upsertRecord(sampleRecord(wsSlug, "s1", "src/x.ts"));
    await seed.close();

    const first = await runRekeyMigration();
    expect(first.kind).toBe("ok");
    const backupsAfterFirst = fs
      .readdirSync(storeDir)
      .filter((f) => f.startsWith("store.db.pre-rekey-"));

    const second = await runRekeyMigration();
    expect(second.kind).toBe("noop");
    const backupsAfterSecond = fs
      .readdirSync(storeDir)
      .filter((f) => f.startsWith("store.db.pre-rekey-"));
    // No new backup written on the noop second run.
    expect(backupsAfterSecond).toEqual(backupsAfterFirst);
  });

  it("returns noop when no workspace folders are open", async () => {
    setFolders([]);
    const result = await runRekeyMigration();
    expect(result.kind).toBe("noop");
  });

  it("returns noop when store.db does not exist yet", async () => {
    const folder = path.join(tmpRoot, "fresh");
    gitInit(folder, "https://github.com/org/repo.git");
    setFolders([{ fsPath: folder }]);
    // No store.db created.
    const result = await runRekeyMigration();
    expect(result.kind).toBe("noop");
  });
});

// ─── isStoreRekeyedToRepo (one-way guard) ─────────────────────────────────

describe("isStoreRekeyedToRepo", () => {
  let tmp: string;
  let storeDir: string;
  let originalGetConfiguration: unknown;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amm-rekey-flag-"));
    storeDir = path.join(tmp, "store");
    fs.mkdirSync(storeDir, { recursive: true });
    originalGetConfiguration = vscodeAny.workspace.getConfiguration;
    vscodeAny.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue: unknown) => (key === "storeDir" ? storeDir : defaultValue),
    });
  });

  afterEach(() => {
    vscodeAny.workspace.getConfiguration = originalGetConfiguration;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns false when store.db does not exist", async () => {
    expect(await isStoreRekeyedToRepo()).toBe(false);
  });

  it("returns false when flag is absent, true after writeMetaFlag", async () => {
    const dbPath = path.join(storeDir, "store.db");
    const store = new SqliteStore(dbPath);
    await store.listProjectSummaries();
    expect(await isStoreRekeyedToRepo()).toBe(false);
    await store.writeMetaFlag(REKEY_FLAG_KEY, true);
    expect(await isStoreRekeyedToRepo()).toBe(true);
    await store.close();
  });
});
