const INGEST_URL = process.env.AGENT_MINDMAP_DEBUG_INGEST;
const INGEST_SESSION_ID = process.env.AGENT_MINDMAP_DEBUG_SESSION_ID ?? "default";

/** NDJSON debug ingest for LLM dump investigation (debug mode).
 *  Only active when AGENT_MINDMAP_DEBUG_INGEST env var is set to the ingest URL. */
export function agentDebugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string
): void {
  if (!INGEST_URL) return;
  fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": INGEST_SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: INGEST_SESSION_ID,
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
