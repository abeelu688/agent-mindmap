/**
 * CLI config store — reads/writes JSON config from project and user locations.
 *
 * Project config: `./.agent-mindmap/config.json`
 * User config:    `$XDG_CONFIG_HOME/agent-mindmap/config.json`
 *                 (fallback: `~/.config/agent-mindmap/config.json` on Linux/macOS,
 *                  `%APPDATA%\agent-mindmap\config.json` on Windows)
 *
 * Keys are 1:1 with `agentMindmap.*` extension settings.
 * Team tokens are written with file mode 0600.
 */
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { resolveStoreDir } from "@agent-mindmap/shared";
import type { ConfigStore } from "@agent-mindmap/core";

// ────────────────────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────────────────────

function xdgConfigHome(): string {
  const env = process.env.XDG_CONFIG_HOME;
  if (env) return env;
  return path.join(os.homedir(), ".config");
}

function windowsConfigDir(): string {
  const env = process.env.APPDATA;
  if (env) return env;
  return path.join(os.homedir(), "AppData", "Roaming");
}

export function userConfigDir(): string {
  if (process.platform === "win32") {
    return path.join(windowsConfigDir(), "agent-mindmap");
  }
  return path.join(xdgConfigHome(), "agent-mindmap");
}

export function userConfigPath(): string {
  return path.join(userConfigDir(), "config.json");
}

export function projectConfigDir(cwd: string): string {
  return path.join(cwd, ".agent-mindmap");
}

export function projectConfigPath(cwd: string): string {
  return path.join(projectConfigDir(cwd), "config.json");
}

// ────────────────────────────────────────────────────────────────────────────
// Read / write
// ────────────────────────────────────────────────────────────────────────────

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function writeJsonFile(
  filePath: string,
  data: Record<string, unknown>,
  mode?: number
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", mode ? { mode } : {});
  await fs.rename(tmpPath, filePath);
}

// ────────────────────────────────────────────────────────────────────────────
// CLI ConfigStore implementation
// ────────────────────────────────────────────────────────────────────────────

export type CliConfigOptions = {
  /** Override working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Override store directory. */
  storeDir?: string;
};

export class CliConfigStore implements ConfigStore {
  private projectConfig: Record<string, unknown> = {};
  private userConfig: Record<string, unknown> = {};
  private cwd: string;
  private _storeDir?: string;

  constructor(opts: CliConfigOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this._storeDir = opts.storeDir;
  }

  /** Load config from disk. Call before first get/set. */
  async load(): Promise<void> {
    const [proj, user] = await Promise.all([
      readJsonFile(projectConfigPath(this.cwd)),
      readJsonFile(userConfigPath()),
    ]);
    this.projectConfig = proj ?? {};
    this.userConfig = user ?? {};
  }

  /** Get a config value. Project config takes precedence over user config. */
  get<T>(key: string): T | undefined {
    if (key in this.projectConfig) {
      return this.projectConfig[key] as T;
    }
    if (key in this.userConfig) {
      return this.userConfig[key] as T;
    }
    // Check env var override: AGENT_MINDMAP_<KEY> with dots → underscores
    const envKey = `AGENT_MINDMAP_${key.replace(/\./g, "_").toUpperCase()}`;
    const envVal = process.env[envKey];
    if (envVal !== undefined) {
      // Try to parse as JSON, fall back to string
      try {
        return JSON.parse(envVal) as T;
      } catch {
        return envVal as unknown as T;
      }
    }
    return undefined;
  }

  /** Set a config value. Writes to user config by default. */
  async set(key: string, value: unknown): Promise<void> {
    this.userConfig[key] = value;
    await writeJsonFile(userConfigPath(), this.userConfig);
  }

  /** Set a project-level config value. */
  async setProject(key: string, value: unknown): Promise<void> {
    this.projectConfig[key] = value;
    await writeJsonFile(projectConfigPath(this.cwd), this.projectConfig);
  }

  /** List all config keys and values. */
  list(): Record<string, unknown> {
    return { ...this.userConfig, ...this.projectConfig };
  }

  /** Get the resolved store directory. */
  get storeDir(): string {
    return this._storeDir ?? resolveStoreDir();
  }

  /** Get the user config path. */
  get userConfigFilePath(): string {
    return userConfigPath();
  }
}
