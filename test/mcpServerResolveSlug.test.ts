/**
 * resolveSlug repo-mode self-detection: when the paths map and store both
 * miss, the MCP server probes `git remote.origin.url` to derive a repo slug.
 * `checkRepoPrerequisites` is mocked so no real git is invoked.
 */
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRepoPrerequisites } from "@agent-mindmap/core";
import { bootstrapStore } from "../shared/src";
import { createMcpHandlerContext, resolveSlug } from "../mcp-server/src/handlers";
import { createPathsResolver } from "../mcp-server/src/pathsMap";

vi.mock("@agent-mindmap/core", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, checkRepoPrerequisites: vi.fn() };
});

const mockedCheckRepo = vi.mocked(checkRepoPrerequisites);

async function mkRepoModeStore(): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-resolve-"));
  await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
  await fs.writeFile(path.join(tmp, "repo-paths.json"), JSON.stringify({}));
  return tmp;
}

async function cleanupStore(tmp: string, store: unknown): Promise<void> {
  try {
    await (store as { close?: () => Promise<void> }).close?.();
  } catch {
    // ignore
  }
  await fs.rm(tmp, { recursive: true, force: true });
}

describe("resolveSlug repo self-detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes git origin in repo mode when paths map misses", async () => {
    const tmp = await mkRepoModeStore();
    const result = await bootstrapStore(tmp);
    try {
      mockedCheckRepo.mockResolvedValue({
        ok: true,
        uri: "https://github.com/org/repo.git",
      });
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const slug = await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      expect(slug).toBe("org/repo.git");
      expect(mockedCheckRepo).toHaveBeenCalledWith(path.resolve("/home/cloned/repo"));
    } finally {
      await cleanupStore(tmp, result.store);
    }
  });

  it("returns undefined when probe reports not-a-git-repo", async () => {
    const tmp = await mkRepoModeStore();
    const result = await bootstrapStore(tmp);
    try {
      mockedCheckRepo.mockResolvedValue({ ok: false, reason: "非 git 仓库" });
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const slug = await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      expect(slug).toBeUndefined();
    } finally {
      await cleanupStore(tmp, result.store);
    }
  });

  it("caches the probe result across calls for the same folder", async () => {
    const tmp = await mkRepoModeStore();
    const result = await bootstrapStore(tmp);
    try {
      mockedCheckRepo.mockResolvedValue({
        ok: true,
        uri: "https://github.com/org/cached.git",
      });
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      expect(mockedCheckRepo).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupStore(tmp, result.store);
    }
  });

  it("still uses workspace slug in workspace mode (no probe)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-resolve-"));
    const result = await bootstrapStore(tmp);
    try {
      await fs.writeFile(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
      mockedCheckRepo.mockResolvedValue({ ok: true, uri: "https://github.com/org/x.git" });
      const ctx = createMcpHandlerContext(result.store, tmp, createPathsResolver(tmp));
      const slug = await resolveSlug(ctx, { projectPath: "/home/cloned/repo" });
      expect(slug).toBe("home-cloned-repo");
      expect(mockedCheckRepo).not.toHaveBeenCalled();
    } finally {
      await cleanupStore(tmp, result.store);
    }
  });
});
