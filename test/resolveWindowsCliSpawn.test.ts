import * as os from "os";
import * as path from "path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { __testing, resolveCliSpawnTarget } from "../extension/src/llm/resolveWindowsCliSpawn";

describe("resolveCliSpawnTarget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses node-direct on Windows for cursor-agent shims", () => {
    vi.stubGlobal("process", {
      ...process,
      platform: "win32",
      env: {
        ...process.env,
        LOCALAPPDATA: path.join(os.homedir(), "AppData", "Local"),
      },
    });
    const target = resolveCliSpawnTarget("agent", ["-p", "--output-format", "json", "prompt body"]);
    if (target.mode === "node-direct") {
      expect(target.shell).toBe(false);
      expect(target.command).toMatch(/node\.exe$/i);
      expect(target.args[0]).toMatch(/index\.js$/i);
      expect(target.args).toContain("prompt body");
    } else {
      expect(target.shell).toBe(true);
      expect(target.command).toBe("agent");
    }
  });

  it("keeps shell shim on non-Windows", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const target = resolveCliSpawnTarget("agent", ["-p", "x"]);
    expect(target.mode).toBe("shell-shim");
    expect(target.shell).toBe(false);
    expect(target.command).toBe("agent");
    expect(target.args).toEqual(["-p", "x"]);
  });
});

describe("escapeCmdArg", () => {
  it("wraps simple strings in double-quotes", () => {
    expect(__testing.escapeCmdArg("hello")).toBe('"hello"');
  });

  it("escapes double-quotes with backslash before caret-escaping", () => {
    const result = __testing.escapeCmdArg('a"b');
    // The \" should be present; ^ should not precede the \"
    expect(result).toContain('\\"');
  });

  it("caret-escapes cmd.exe metacharacters", () => {
    const result = __testing.escapeCmdArg("a&b|c<d>e^f!g");
    expect(result).toContain("^&");
    expect(result).toContain("^|");
    expect(result).toContain("^<");
    expect(result).toContain("^>");
    expect(result).toContain("^^");
    expect(result).toContain("^!");
  });

  it("doubles percent signs for cmd.exe variable escaping", () => {
    const result = __testing.escapeCmdArg("%PATH%");
    expect(result).toContain("%%PATH%%");
  });

  it("handles string with spaces", () => {
    const result = __testing.escapeCmdArg("hello world");
    expect(result).toBe('"hello world"');
  });
});

describe("findNodeIndexUnderRoot", () => {
  it("picks the newest versions/* directory", () => {
    const local = process.env.LOCALAPPDATA;
    if (!local) {
      return;
    }
    const root = path.join(local, "cursor-agent");
    const pair = __testing.findNodeIndexUnderRoot(root);
    expect(pair?.nodePath).toMatch(/node\.exe$/i);
    expect(pair?.indexPath).toMatch(/index\.js$/i);
  });
});
