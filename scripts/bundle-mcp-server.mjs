import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "extension", "mcp-server");
const OUT_FILE = path.join(OUT_DIR, "index.js");

await fs.mkdir(OUT_DIR, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(ROOT, "mcp-server", "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: OUT_FILE,
  sourcemap: true,
  logLevel: "info",
  alias: {
    "@agent-mindmap/shared": path.join(ROOT, "shared", "src", "index.ts"),
  },
});

const raw = await fs.readFile(OUT_FILE, "utf8");
if (!raw.startsWith("#!")) {
  await fs.writeFile(OUT_FILE, `#!/usr/bin/env node\n${raw}`, "utf8");
}
await fs.chmod(OUT_FILE, 0o755);
console.log(`Bundled MCP server -> ${OUT_FILE}`);
