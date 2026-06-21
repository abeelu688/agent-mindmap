import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as vscode from "vscode";
import {
  __testing,
  checkRepoModeGate,
  checkRepoPrerequisites,
  getCachedRepoSlug,
  getProjectMode,
  normalizeRepoUriToSlug,
} from "../extension/src/host/slugDerivation";

describe("normalizeRepoUriToSlug", () => {
  it("strips http scheme + host:port, keeps org/repo.git", () => {
    expect(normalizeRepoUriToSlug("http://192.168.1.70:2000/ailab/agent-mindmap.git")).toBe(
      "ailab/agent-mindmap.git"
    );
  });

  it("strips gogs@ scp prefix + host, keeps org/repo.git", () => {
    expect(normalizeRepoUriToSlug("gogs@192.168.1.70:ailab/agent-mindmap.git")).toBe(
      "ailab/agent-mindmap.git"
    );
  });

  it("strips ssh:// scheme + user@host:port, keeps org/repo.git", () => {
    expect(normalizeRepoUriToSlug("ssh://git@github.com:22/org/repo.git")).toBe("org/repo.git");
  });

  it("strips https scheme + host, keeps org/repo.git", () => {
    expect(normalizeRepoUriToSlug("https://github.com/org/repo.git")).toBe("org/repo.git");
  });

  it("all four transports for the same repo collapse to one slug", () => {
    const a = normalizeRepoUriToSlug("http://192.168.1.70:2000/ailab/agent-mindmap.git");
    const b = normalizeRepoUriToSlug("gogs@192.168.1.70:ailab/agent-mindmap.git");
    expect(a).toBe(b);
  });

  it("strips trailing slash", () => {
    expect(normalizeRepoUriToSlug("https://github.com/org/repo.git/")).toBe("org/repo.git");
  });

  it("keeps .git suffix (separates repo slugs from workspace slugs)", () => {
    expect(normalizeRepoUriToSlug("https://github.com/org/repo.git")).toMatch(/\.git$/);
  });

  it("returns bare path-like strings as-is", () => {
    expect(normalizeRepoUriToSlug("ailab/agent-mindmap.git")).toBe("ailab/agent-mindmap.git");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeRepoUriToSlug("")).toBe("");
    expect(normalizeRepoUriToSlug("   ")).toBe("");
  });
});

// ─── Real-git fixtures for checkRepoPrerequisites ─────────────────────────────
// Uses execFileSync to set up real temp git repos; avoids execFile mocking.

function gitInit(dir: string, originUrl?: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  if (originUrl) {
    execFileSync("git", ["remote", "add", "origin", originUrl], { cwd: dir, stdio: "ignore" });
  }
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amm-slug-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  // restore the vscode mock to its default (no workspaceFolders, default-returning get)
  (
    vscode as unknown as { workspace: { workspaceFolders?: unknown; getConfiguration: unknown } }
  ).workspace.workspaceFolders = undefined;
  (
    vscode as unknown as {
      workspace: { getConfiguration: () => { get: (k: string, d: unknown) => unknown } };
    }
  ).workspace.getConfiguration = () => ({
    get: (_key: string, defaultValue: unknown) => defaultValue,
  });
  __testing.repoSlugCache.clear();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("checkRepoPrerequisites", () => {
  it("succeeds for a git repo root with origin", async () => {
    const dir = path.join(tmpRoot, "valid");
    gitInit(dir, "https://github.com/org/repo.git");
    const res = await checkRepoPrerequisites(dir);
    expect(res).toEqual({ ok: true, uri: "https://github.com/org/repo.git" });
  });

  it("fails with 非-git-仓库 for a non-git folder", async () => {
    const dir = path.join(tmpRoot, "nogit");
    fs.mkdirSync(dir, { recursive: true });
    const res = await checkRepoPrerequisites(dir);
    expect(res).toEqual({ ok: false, reason: "非 git 仓库" });
  });

  it("fails with 无-origin-remote for a git repo without origin", async () => {
    const dir = path.join(tmpRoot, "noorigin");
    gitInit(dir);
    const res = await checkRepoPrerequisites(dir);
    expect(res).toEqual({ ok: false, reason: "无 origin remote" });
  });

  it("fails with 非-repo-根目录 for a subdirectory of a repo root", async () => {
    const root = path.join(tmpRoot, "root");
    gitInit(root, "https://github.com/org/repo.git");
    const child = path.join(root, "subdir");
    fs.mkdirSync(child, { recursive: true });
    const res = await checkRepoPrerequisites(child);
    expect(res).toEqual({ ok: false, reason: "非 repo 根目录" });
  });
});

describe("checkRepoModeGate", () => {
  function setFolders(folders: { fsPath: string }[]): void {
    (
      vscode as unknown as { workspace: { workspaceFolders?: unknown } }
    ).workspace.workspaceFolders = folders.map((f) => ({ uri: f }));
  }

  it("returns broken:false and populates cache when all folders pass", async () => {
    const dir = path.join(tmpRoot, "valid");
    gitInit(dir, "https://github.com/org/repo.git");
    setFolders([{ fsPath: dir }]);
    const result = await checkRepoModeGate();
    expect(result).toEqual({ broken: false });
    expect(getCachedRepoSlug(dir)).toBe("org/repo.git");
  });

  it("returns broken:true with failures when a folder fails", async () => {
    const valid = path.join(tmpRoot, "valid");
    const nogit = path.join(tmpRoot, "nogit");
    gitInit(valid, "https://github.com/org/repo.git");
    fs.mkdirSync(nogit, { recursive: true });
    setFolders([{ fsPath: valid }, { fsPath: nogit }]);
    const result = await checkRepoModeGate();
    expect(result.broken).toBe(true);
    if (result.broken) {
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.folder).toBe(nogit);
      expect(result.failures[0]!.reason).toBe("非 git 仓库");
    }
    // failing folder is NOT in cache; passing folder IS
    expect(getCachedRepoSlug(valid)).toBe("org/repo.git");
    expect(getCachedRepoSlug(nogit)).toBeUndefined();
  });

  it("clears cache before re-running (idempotent re-derivation)", async () => {
    const dir = path.join(tmpRoot, "valid");
    gitInit(dir, "https://github.com/org/repo.git");
    setFolders([{ fsPath: dir }]);
    await checkRepoModeGate();
    expect(getCachedRepoSlug(dir)).toBe("org/repo.git");

    // remove the folder from workspace; re-run; cache should be cleared of the old entry
    setFolders([]);
    await checkRepoModeGate();
    expect(getCachedRepoSlug(dir)).toBeUndefined();
  });

  it("returns broken:false for empty workspace", async () => {
    setFolders([]);
    const result = await checkRepoModeGate();
    expect(result).toEqual({ broken: false });
  });
});

describe("getProjectMode", () => {
  function setMode(value: unknown): void {
    (
      vscode as unknown as {
        workspace: { getConfiguration: () => { get: (k: string, d: unknown) => unknown } };
      }
    ).workspace.getConfiguration = () => ({
      get: (_key: string, defaultValue: unknown) => (value === undefined ? defaultValue : value),
    });
  }

  it("returns 'repo' when set to repo", () => {
    setMode("repo");
    expect(getProjectMode()).toBe("repo");
  });

  it("returns 'workspace' when set to workspace", () => {
    setMode("workspace");
    expect(getProjectMode()).toBe("workspace");
  });

  it("coerces unknown values to workspace", () => {
    setMode("garbage");
    expect(getProjectMode()).toBe("workspace");
  });

  it("defaults to workspace when setting absent", () => {
    setMode(undefined);
    expect(getProjectMode()).toBe("workspace");
  });
});
