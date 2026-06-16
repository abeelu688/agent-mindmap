import * as fs from "fs/promises";
import * as path from "path";

const isWindows = process.platform === "win32";

let writeCounter = 0;

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const data = JSON.stringify(value, null, 2);
  const tag = `${process.pid}-${Date.now()}-${++writeCounter}`;
  const tmp = `${filePath}.tmp-${tag}`;

  await fs.writeFile(tmp, data, "utf8");

  if (isWindows) {
    await fs.copyFile(tmp, filePath);
    await fs.unlink(tmp).catch(() => {});
  } else {
    await fs.rename(tmp, filePath);
  }
}
