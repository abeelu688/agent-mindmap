import * as esbuild from "esbuild";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const watch = process.argv.includes("--watch");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_MD_OUT = path.join(HERE, "media", "transcript-markdown.js");

const extensionBuild = {
  entryPoints: [path.join(HERE, "src/extension.ts")],
  bundle: true,
  outfile: path.join(HERE, "dist/extension.js"),
  external: ["vscode", "@vscode/sqlite3"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

const transcriptMarkdownBuild = {
  entryPoints: [path.join(HERE, "src/export/transcriptMarkdownBrowser.ts")],
  bundle: true,
  outfile: TRANSCRIPT_MD_OUT,
  format: "iife",
  platform: "browser",
  target: "es2020",
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(extensionBuild);
    const mdCtx = await esbuild.context(transcriptMarkdownBuild);
    await Promise.all([ctx.watch(), mdCtx.watch()]);
    console.log("watching extension + transcript-markdown...");
    return;
  }
  await fs.mkdir(path.dirname(TRANSCRIPT_MD_OUT), { recursive: true });
  await Promise.all([
    esbuild.build(extensionBuild),
    esbuild.build(transcriptMarkdownBuild),
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
