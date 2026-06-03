import sqlite3 from "@vscode/sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
  clearComposerTitleCache,
  loadComposerHeaders,
  loadComposerTitles,
} from "../extension/src/transcript/composerTitles";

async function createFixtureDb(): Promise<{
  dbPath: string;
  composerId: string;
  cleanup: () => void;
}> {
  const dir = mkdtempSync(join(tmpdir(), "agent-mindmap-state-"));
  const dbPath = join(dir, "state.vscdb");
  const composerId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  const db = await new Promise<sqlite3.Database>((resolve, reject) => {
    const handle = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(handle);
    });
  });
  const exec = promisify(db.exec.bind(db)) as (sql: string) => Promise<void>;
  const run = promisify(db.run.bind(db)) as (
    sql: string,
    params?: unknown[]
  ) => Promise<void>;

  await exec(`
    CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT);
  `);
  await run("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    `composerData:${composerId}`,
    JSON.stringify({ name: "Fix JIT hooks" }),
  ]);
  await run("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)", [
    "composerData:placeholder-id",
    JSON.stringify({ name: "New Agent" }),
  ]);
  await run("INSERT INTO ItemTable (key, value) VALUES (?, ?)", [
    "composer.composerHeaders",
    JSON.stringify({
      allComposers: [
        {
          composerId,
          name: "Fix JIT hooks",
          type: "head",
          isArchived: false,
          workspaceIdentifier: {
            uri: { fsPath: "/home/user/project" },
          },
        },
      ],
    }),
  ]);

  await promisify(db.close.bind(db))();

  return {
    dbPath,
    composerId,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function mockCursorStateDb(dbPath: string): void {
  vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue({
    get: (key: string, defaultValue?: unknown) =>
      key === "cursorStateDb" ? dbPath : defaultValue,
  } as ReturnType<typeof vscode.workspace.getConfiguration>);
}

describe("composerTitles state.vscdb readers", () => {
  afterEach(() => {
    clearComposerTitleCache();
    vi.restoreAllMocks();
  });

  it("loadComposerTitles reads composerData names via readonly sqlite", async () => {
    const fixture = await createFixtureDb();
    mockCursorStateDb(fixture.dbPath);

    const titles = await loadComposerTitles();
    expect(titles.get(fixture.composerId)).toBe("Fix JIT hooks");
    expect(titles.has("placeholder-id")).toBe(false);

    fixture.cleanup();
  });

  it("loadComposerHeaders reads composer.composerHeaders via readonly sqlite", async () => {
    const fixture = await createFixtureDb();
    mockCursorStateDb(fixture.dbPath);

    const headers = await loadComposerHeaders();
    const meta = headers.get(fixture.composerId);
    expect(meta?.name).toBe("Fix JIT hooks");
    expect(meta?.workspacePath).toBe("/home/user/project");
    expect(meta?.type).toBe("head");

    fixture.cleanup();
  });
});
