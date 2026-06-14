import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(ROOT, "extension");

try {
  await esbuild.build({
    entryPoints: [path.join(ROOT, "test/fixtures/run-multilingual-html.ts")],
    bundle: true,
    platform: "node",
    outfile: path.join(ext, "dist/multilingual-html-run.js"),
    external: ["@vscode/sqlite3"],
    alias: {
      vscode: path.join(ROOT, "test/fixtures/vscode-multilingual-stub.cjs"),
    },
    logLevel: "info",
  });
  console.log("multilingual-html-run.js built OK");
} catch (err) {
  console.error("build failed:", err);
  process.exit(1);
}
