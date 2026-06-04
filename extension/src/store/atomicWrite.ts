import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const isWindows = process.platform === "win32";

/** Counter to guarantee unique temp filenames within the same millisecond. */
let writeCounter = 0;

/**
 * Atomically write JSON to a file.
 *
 * On POSIX, `fs.rename` over an existing file is atomic so the standard
 * write-then-rename pattern works.  On Windows, `fs.rename` fails with
 * EPERM/EBUSY when the target exists, so we fall back to writing directly
 * and then renaming via `fs.copyFile` + delete.
 */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const data = JSON.stringify(value, null, 2);
  const tag = `${process.pid}-${Date.now()}-${++writeCounter}`;
  const tmp = `${filePath}.tmp-${tag}`;

  await fs.writeFile(tmp, data, "utf8");

  if (isWindows) {
    // Windows: rename over existing file is unreliable, use copyFile + unlink
    await fs.copyFile(tmp, filePath);
    await fs.unlink(tmp).catch(() => {
      // best-effort cleanup; file may already be gone
    });
  } else {
    await fs.rename(tmp, filePath);
  }
}

/** Remove stale .tmp files left by previous failed writes. */
export async function cleanStaleTempFiles(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.includes(".tmp-")) continue;
    const fullPath = path.join(dir, name);
    try {
      const stat = await fs.stat(fullPath);
      // Remove temp files older than 1 hour
      if (now - stat.mtimeMs > 3600_000) {
        await fs.unlink(fullPath);
      }
    } catch {
      // ignore
    }
  }
}
