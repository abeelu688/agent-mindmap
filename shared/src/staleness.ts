import type { Staleness } from "./llmTypes";

/**
 * On-read staleness computation for `CodeReference` (Q4 §Decided design items
 * 3 + 6). Pure function — callers handle path resolution and file I/O.
 *
 * @param markCode The `CodeReference.markCode` effective-lines array. `[]` or
 *   `undefined` → `unknown` (cannot judge).
 * @param fileContent The file content at `CodeReference.path`, or `undefined`
 *   if the file could not be read (missing / unreadable). The content is
 *   matched as-is — no normalization (no CRLF→LF, no indentation strip, no
 *   whitespace collapse). Per-line substring match tolerates indentation
 *   offset and CRLF/LF differences by construction.
 * @returns `"fresh"` if every effective line is a substring of `fileContent`;
 *   `"stale"` if the file is missing or any line is absent; `"unknown"` if
 *   `markCode` is empty/missing.
 */
export function computeStaleness(
  markCode: string[] | undefined,
  fileContent: string | undefined
): Staleness {
  if (!markCode || markCode.length === 0) {
    return "unknown";
  }
  if (fileContent === undefined) {
    return "stale";
  }
  for (const line of markCode) {
    if (!fileContent.includes(line)) {
      return "stale";
    }
  }
  return "fresh";
}
