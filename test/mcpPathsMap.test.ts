import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPathsResolver, readProjectMode } from "../mcp-server/src/pathsMap";

const ORIGINAL_STORE_DIR = process.env.AGENT_MINDMAP_STORE_DIR;

function makeTmpStoreDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mcp-paths-"));
}

describe("readProjectMode", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpStoreDir();
    process.env.AGENT_MINDMAP_STORE_DIR = tmp;
  });

  afterEach(() => {
    if (ORIGINAL_STORE_DIR === undefined) {
      delete process.env.AGENT_MINDMAP_STORE_DIR;
    } else {
      process.env.AGENT_MINDMAP_STORE_DIR = ORIGINAL_STORE_DIR;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 'workspace' when mcp-mode.json is missing", () => {
    expect(readProjectMode()).toBe("workspace");
  });

  it("returns 'repo' when mcp-mode.json has mode=repo", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
    expect(readProjectMode()).toBe("repo");
  });

  it("returns 'workspace' when mcp-mode.json has mode=workspace", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    expect(readProjectMode()).toBe("workspace");
  });

  it("returns 'workspace' for invalid JSON", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), "{not json");
    expect(readProjectMode()).toBe("workspace");
  });
});

describe("createPathsResolver", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = makeTmpStoreDir();
    process.env.AGENT_MINDMAP_STORE_DIR = tmp;
  });

  afterEach(() => {
    if (ORIGINAL_STORE_DIR === undefined) {
      delete process.env.AGENT_MINDMAP_STORE_DIR;
    } else {
      process.env.AGENT_MINDMAP_STORE_DIR = ORIGINAL_STORE_DIR;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves a slug hit against the workspace map", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    const r = createPathsResolver();
    const res = r.resolvePath("home-user-proj", "src/index.ts");
    expect(res).toEqual({ kind: "ok", absPath: path.join("/home/user/proj", "src/index.ts") });
  });

  it("resolves a slug hit against the repo map in repo mode", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
    fs.writeFileSync(
      path.join(tmp, "repo-paths.json"),
      JSON.stringify({ "org/repo.git": "/home/user/repo" })
    );
    const r = createPathsResolver();
    const res = r.resolvePath("org/repo.git", "extension/src/x.ts");
    expect(res).toEqual({
      kind: "ok",
      absPath: path.join("/home/user/repo", "extension/src/x.ts"),
    });
  });

  it("re-reads the map on slug miss (read-on-miss pattern)", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(path.join(tmp, "workspace-paths.json"), JSON.stringify({}));
    const r = createPathsResolver();
    // first lookup: miss (map is empty)
    expect(r.resolvePath("home-user-proj", "x.ts")).toEqual({
      kind: "miss",
      slug: "home-user-proj",
      mode: "workspace",
    });
    // extension writes the entry now
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    // second lookup: re-read on miss → hit
    const res = r.resolvePath("home-user-proj", "x.ts");
    expect(res).toEqual({ kind: "ok", absPath: path.join("/home/user/proj", "x.ts") });
  });

  it("returns miss when slug is absent after re-read", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(path.join(tmp, "workspace-paths.json"), JSON.stringify({}));
    const r = createPathsResolver();
    expect(r.resolvePath("missing-slug", "x.ts")).toEqual({
      kind: "miss",
      slug: "missing-slug",
      mode: "workspace",
    });
  });

  it("returns empty-rel-path for empty relPath", () => {
    const r = createPathsResolver();
    expect(r.resolvePath("any-slug", "")).toEqual({ kind: "empty-rel-path" });
  });

  it("resetCache forces a fresh mode + map read", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "a-slug": "/old/path" })
    );
    const r = createPathsResolver();
    expect(r.resolvePath("a-slug", "x.ts")).toEqual({
      kind: "ok",
      absPath: path.join("/old/path", "x.ts"),
    });
    // change mode + map, reset cache
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "repo" }));
    fs.writeFileSync(path.join(tmp, "repo-paths.json"), JSON.stringify({ "a-slug": "/new/path" }));
    r.resetCache();
    expect(r.resolvePath("a-slug", "x.ts")).toEqual({
      kind: "ok",
      absPath: path.join("/new/path", "x.ts"),
    });
  });

  it("rejects .. path traversal escape", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    const r = createPathsResolver();
    const res = r.resolvePath("home-user-proj", "../secret.txt");
    expect(res.kind).toBe("path-escape");
    if (res.kind === "path-escape") {
      expect(res.attempted).toBe("../secret.txt");
      expect(res.root).toBe("/home/user/proj");
    }
  });

  it("rejects deep .. traversal (../../etc/passwd)", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    const r = createPathsResolver();
    expect(r.resolvePath("home-user-proj", "../../etc/passwd").kind).toBe("path-escape");
  });

  it("rejects absolute relPath", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    const r = createPathsResolver();
    expect(r.resolvePath("home-user-proj", "/etc/passwd").kind).toBe("path-escape");
  });

  it("rejects Windows-style .. escape", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "win-proj": "C:\\Users\\dev\\proj" })
    );
    const r = createPathsResolver();
    expect(r.resolvePath("win-proj", "..\\secret.txt").kind).toBe("path-escape");
  });

  it("allows legitimate subdirectory traversal within root", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    fs.writeFileSync(
      path.join(tmp, "workspace-paths.json"),
      JSON.stringify({ "home-user-proj": "/home/user/proj" })
    );
    const r = createPathsResolver();
    // sub/dir/../other is fine — resolve stays within root
    const res = r.resolvePath("home-user-proj", "sub/dir/../other/file.ts");
    if (res.kind === "ok") {
      expect(res.absPath).toBe(path.join("/home/user/proj", "sub/dir/../other/file.ts"));
    } else {
      // On some platforms path.resolve may resolve this differently
      // The key is it doesn't escape
      expect(res.kind).not.toBe("path-escape");
    }
  });

  it("treats missing map file as empty map (miss)", () => {
    fs.writeFileSync(path.join(tmp, "mcp-mode.json"), JSON.stringify({ mode: "workspace" }));
    // no workspace-paths.json written
    const r = createPathsResolver();
    expect(r.resolvePath("any-slug", "x.ts")).toEqual({
      kind: "miss",
      slug: "any-slug",
      mode: "workspace",
    });
  });
});
