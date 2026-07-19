import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCP_DIR = path.join(ROOT, "mcp-server");
const PRIMARY_OUT_DIR = path.join(MCP_DIR, "dist");
const PRIMARY_OUT_FILE = path.join(PRIMARY_OUT_DIR, "index.js");
// The VSIX packages the MCP server inside extension/mcp-server/ so the
// extension's resolveExistingMcpServerEntry() can find it at runtime.
const VSIX_OUT_DIR = path.join(ROOT, "extension", "mcp-server");
const VSIX_OUT_FILE = path.join(VSIX_OUT_DIR, "index.js");

const rootPkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
const version = rootPkg.version;

await fs.mkdir(PRIMARY_OUT_DIR, { recursive: true });
await fs.mkdir(VSIX_OUT_DIR, { recursive: true });

const buildOptions = (outfile) => ({
  entryPoints: [path.join(MCP_DIR, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile,
  sourcemap: true,
  logLevel: "info",
  define: {
    __MCP_SERVER_VERSION__: JSON.stringify(version),
  },
  external: ["@vscode/sqlite3"],
  alias: {
    "@agent-mindmap/shared": path.join(ROOT, "shared", "src", "index.ts"),
  },
});

await esbuild.build(buildOptions(PRIMARY_OUT_FILE));

// Copy the primary bundle to the VSIX location. esbuild's write+chmod is
// already done; a plain copyFile preserves the content. We add the shebang
// and executable bit the same way as before so both entry points behave
// identically.
const raw = await fs.readFile(PRIMARY_OUT_FILE, "utf8");
const withShebang = raw.startsWith("#!") ? raw : `#!/usr/bin/env node\n${raw}`;
await fs.writeFile(VSIX_OUT_FILE, withShebang, "utf8");
await fs.chmod(VSIX_OUT_FILE, 0o755);

// Also normalize the primary bundle so `node mcp-server/dist/index.js` works
// as a direct entry (matches the `bin` declaration in mcp-server/package.json).
if (!raw.startsWith("#!")) {
  await fs.writeFile(PRIMARY_OUT_FILE, withShebang, "utf8");
}
await fs.chmod(PRIMARY_OUT_FILE, 0o755);

console.log(`Bundled MCP server -> ${PRIMARY_OUT_FILE} (version ${version})`);
console.log(`Copied MCP server  -> ${VSIX_OUT_FILE} (for VSIX packaging)`);
