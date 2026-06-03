import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(ROOT, "extension");

try {
  await esbuild.build({
    entryPoints: [path.join(ROOT, "test/eval/run-eval.ts")],
    bundle: true,
    platform: "node",
    outfile: path.join(ext, "dist/eval-run.js"),
    external: ["@vscode/sqlite3"],
    alias: { vscode: path.join(ROOT, "test/vscode-stub.cjs") },
    logLevel: "info",
  });
  console.log("eval-run.js built OK");
} catch (err) {
  console.error("build failed:", err);
  process.exit(1);
}
