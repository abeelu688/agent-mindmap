import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

// Mock the host + slugDerivation dependencies so writePathsMaps is isolated
// from real git / host resolution. We re-import pathsMap AFTER setting up
// mocks so the mocked module graph is in effect.

const hostMock = {
  encodeWorkspacePath: (fsPath: string) => fsPath.replace(/^\//, "").replace(/\//g, "-"),
};

vi.mock("../extension/src/host", () => ({
  getActiveHost: async () => hostMock,
}));

const prereqMock = vi.fn();
const modeMock = { value: "workspace" as string };

vi.mock("../extension/src/host/slugDerivation", () => ({
  getProjectMode: () => modeMock.value,
  checkRepoPrerequisites: prereqMock,
  normalizeRepoUriToSlug: (uri: string) => uri,
}));

// `writeMcpConfigFiles` (in core) imports `checkRepoPrerequisites` +
// `normalizeRepoUriToSlug` from `core/src/host/repoSlug`. Mock at the source
// path so the core writer uses our test doubles instead of running real
// `git config --get remote.origin.url` subprocesses.
vi.mock("../core/src/host/repoSlug", () => ({
  checkRepoPrerequisites: prereqMock,
  normalizeRepoUriToSlug: (uri: string) => uri,
}));

// getStoreDir reads from env AGENT_MINDMAP_STORE_DIR, so we don't mock paths.

// vi.mock calls above are hoisted; this top-level await import picks up the
// mocked module graph. A stable ref is fine — the module reads vscode + config
// at call time.
const { writePathsMaps } = await import("../extension/src/store/pathsMap");

describe("extension pathsMap.writePathsMaps", () => {
  let tmp: string;
  let originalStoreDir: string | undefined;

  const vscodeAny = vscode as any;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ext-paths-"));
    originalStoreDir = process.env.AGENT_MINDMAP_STORE_DIR;
    process.env.AGENT_MINDMAP_STORE_DIR = tmp;
    modeMock.value = "workspace";
    prereqMock.mockReset();
    vscodeAny.workspace.workspaceFolders = undefined;
    // getStoreDir() reads vscode.workspace.getConfiguration("agentMindmap").get("storeDir")
    // — make the mock return our tmp dir so writes land there, not in ~/.agent-mindmap.
    vscodeAny.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue: unknown) => (key === "storeDir" ? tmp : defaultValue),
    });
  });

  afterEach(() => {
    if (originalStoreDir === undefined) {
      delete process.env.AGENT_MINDMAP_STORE_DIR;
    } else {
      process.env.AGENT_MINDMAP_STORE_DIR = originalStoreDir;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Static import — vi.resetModules() would re-import the vscode mock and lose
  // the getConfiguration patch applied in beforeEach. The module under test
  // reads vscode + getStoreDir at call time, so a stable module ref is fine.

  function setFolders(folders: { fsPath: string }[]): void {
    vscodeAny.workspace.workspaceFolders = folders.map((f) => ({ uri: { fsPath: f.fsPath } }));
  }

  it("writes workspace-paths.json with host-encoded slugs", async () => {
    setFolders([{ fsPath: "/home/user/projA" }, { fsPath: "/home/user/projB" }]);
    await writePathsMaps();

    const map = JSON.parse(fs.readFileSync(path.join(tmp, "workspace-paths.json"), "utf8"));
    expect(map).toEqual({
      "home-user-projA": "/home/user/projA",
      "home-user-projB": "/home/user/projB",
    });
  });

  it("writes repo-paths.json only for folders passing repo prerequisites (first-seen wins)", async () => {
    modeMock.value = "repo";
    setFolders([
      { fsPath: "/home/user/repo1" },
      { fsPath: "/home/user/repo2-colliding" }, // same normalized slug as repo1
      { fsPath: "/home/user/nongit" },
    ]);
    prereqMock.mockImplementation(async (folder: string) => {
      if (folder === "/home/user/nongit") {
        return { ok: false, reason: "非 git 仓库" };
      }
      // both repo1 and repo2-colliding normalize to the same slug
      return { ok: true, uri: "org/repo.git" };
    });
    await writePathsMaps();

    const map = JSON.parse(fs.readFileSync(path.join(tmp, "repo-paths.json"), "utf8"));
    // first-seen (repo1) wins; repo2-colliding skipped; nongit excluded
    expect(map).toEqual({ "org/repo.git": "/home/user/repo1" });
  });

  it("writes mcp-mode.json with the current mode", async () => {
    modeMock.value = "repo";
    setFolders([]);
    await writePathsMaps();

    const modeFile = JSON.parse(fs.readFileSync(path.join(tmp, "mcp-mode.json"), "utf8"));
    expect(modeFile).toEqual({ mode: "repo" });
  });

  it("writes empty maps for empty workspace", async () => {
    setFolders([]);
    await writePathsMaps();

    const wsMap = JSON.parse(fs.readFileSync(path.join(tmp, "workspace-paths.json"), "utf8"));
    const repoMap = JSON.parse(fs.readFileSync(path.join(tmp, "repo-paths.json"), "utf8"));
    expect(wsMap).toEqual({});
    expect(repoMap).toEqual({});
  });

  it("repo map excludes folders that fail prerequisites (no entry written)", async () => {
    modeMock.value = "repo";
    setFolders([{ fsPath: "/home/user/valid" }, { fsPath: "/home/user/bad" }]);
    prereqMock.mockImplementation(async (folder: string) => {
      if (folder === "/home/user/valid") return { ok: true, uri: "org/valid.git" };
      return { ok: false, reason: "无 origin remote" };
    });
    await writePathsMaps();

    const map = JSON.parse(fs.readFileSync(path.join(tmp, "repo-paths.json"), "utf8"));
    expect(map).toEqual({ "org/valid.git": "/home/user/valid" });
  });
});
