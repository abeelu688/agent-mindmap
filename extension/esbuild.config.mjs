import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const extensionBuild = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(extensionBuild);
    await ctx.watch();
    console.log("watching extension...");
    return;
  }
  await esbuild.build(extensionBuild);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
