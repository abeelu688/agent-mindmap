/**
 * Core host accessor — decouples from `extension/src/host/registry`.
 *
 * The extension resolves the active host from workspace state + VS Code settings;
 * the CLI resolves from `--host` flag + config file; tests inject a fixed host.
 */
import type { AgentHost } from "../host/types";

export interface HostAccess {
  /** Get the currently active agent host. */
  getActiveHost(): Promise<AgentHost>;

  /** Get the current workspace path. Returns undefined if no workspace. */
  getWorkspacePath(): string | undefined;

  /** Get the workspace slug for the given host. */
  getWorkspaceSlug(host: AgentHost): string | undefined;
}
