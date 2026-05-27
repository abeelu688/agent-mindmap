/**
 * Claude Code project directory encoding under `~/.claude/projects/`.
 *
 * Replaces `/`, `\`, `:`, spaces, and `_` with `-` (lossy; see anthropics/claude-code#9221).
 */
export function encodeClaudeProjectPath(fsPath: string): string {
  return fsPath.replace(/[/\\:_ ]/g, "-");
}

/** Best-effort inverse — ambiguous when original segments contained `-` or spaces. */
export function decodeClaudeProjectPath(encoded: string): string {
  if (/^[A-Za-z]--/.test(encoded)) {
    // Windows drive letter: C--Users-... → C:\Users\...
    const drive = encoded[0];
    const rest = encoded.slice(3).replace(/-/g, "/");
    return `${drive}:\\${rest}`;
  }
  if (encoded.startsWith("-")) {
    return "/" + encoded.slice(1).replace(/-/g, "/");
  }
  return encoded.replace(/-/g, "/");
}
