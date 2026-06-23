/**
 * Resolve the media directory for CLI dump commands.
 *
 * In development: `<cli-root>/media/` (populated by bundle-cli-assets.mjs).
 * When installed globally: adjacent to the installed package.
 */
import * as path from "path";
import * as fs from "fs";

/**
 * Resolve the absolute path to the CLI's media directory.
 *
 * Search order:
 * 1. `cli/media/` relative to this source file (development / monorepo)
 * 2. `media/` relative to the installed package root
 * 3. `../extension/media/` relative to the monorepo root (fallback)
 */
export function resolveMediaDir(): string {
  // __dirname in the bundled CLI is the dist/ directory
  const thisDir = __dirname;

  // Attempt 1: cli/media/ (standard location after bundle-cli-assets)
  const candidate1 = path.resolve(thisDir, "..", "media");
  if (fs.existsSync(path.join(candidate1, "webview.js"))) {
    return candidate1;
  }

  // Attempt 2: adjacent media/ (npm install -g scenario)
  const candidate2 = path.resolve(thisDir, "media");
  if (fs.existsSync(path.join(candidate2, "webview.js"))) {
    return candidate2;
  }

  // Attempt 3: monorepo fallback — extension/media/
  const candidate3 = path.resolve(thisDir, "..", "..", "extension", "media");
  if (fs.existsSync(path.join(candidate3, "webview.js"))) {
    return candidate3;
  }

  // Not found — return best guess (will error at dump time with a clear message)
  return candidate1;
}
