import * as fs from "fs/promises";
import * as path from "path";

const distIndex = path.join(__dirname, "index.js");
const raw = await fs.readFile(distIndex, "utf8");
if (!raw.startsWith("#!")) {
  await fs.writeFile(distIndex, `#!/usr/bin/env node\n${raw}`, "utf8");
  await fs.chmod(distIndex, 0o755);
}
