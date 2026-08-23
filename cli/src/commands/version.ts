/**
 * `agent-mindmap version` — print CLI version info.
 */
import { Command } from "commander";
import { CORE_PACKAGE_VERSION, PIPELINE_VERSION } from "@agent-mindmap/core";
import { log, isJsonMode, printJson } from "../ui/logger";

type VersionInfo = {
  cli: string;
  core: string;
  pipelineVersion: number;
  node: string;
};

function getVersionInfo(): VersionInfo {
  const fs = require("fs"); // eslint-disable-line @typescript-eslint/no-require-imports
  const path = require("path"); // eslint-disable-line @typescript-eslint/no-require-imports
  // In the bundled layout (cli/dist/index.js or a global npm install) the
  // package.json is one level up; in source (cli/src/commands) it is two.
  let pkgPath = path.join(__dirname, "..", "package.json");
  if (!fs.existsSync(pkgPath)) {
    pkgPath = path.join(__dirname, "..", "..", "package.json");
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version: string };
  return {
    cli: pkg.version,
    core: CORE_PACKAGE_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    node: process.version,
  };
}

export const versionCommand = new Command("version")
  .description("Print CLI version information")
  .action(() => {
    const info = getVersionInfo();
    if (isJsonMode()) {
      printJson(info);
      return;
    }
    log(`Agent Mind Map CLI v${info.cli}`);
    log(`  @agent-mindmap/core: v${info.core}`);
    log(`  PIPELINE_VERSION:    ${info.pipelineVersion}`);
    log(`  Node.js:             ${info.node}`);
  });
