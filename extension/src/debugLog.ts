/** NDJSON debug ingest for LLM dump investigation (debug mode). */
export function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  // #region agent log
  fetch("http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "214de8",
    },
    body: JSON.stringify({
      sessionId: "214de8",
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}
