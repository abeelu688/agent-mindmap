import * as fs from "fs/promises";
import * as http from "http";
import * as https from "https";
import * as path from "path";

const ENDPOINT =
  "http://127.0.0.1:7901/ingest/4949e060-0582-4e25-a1f5-3c9b36f3b66d";
const SESSION_ID = "bb9cbb";
const LOG_PATH = "/home/example/cursor/airecorder/.cursor/debug-bb9cbb.log";

type Payload = {
  sessionId: string;
  runId: string;
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({
      sessionId: SESSION_ID,
      runId: "stringify-failed",
      hypothesisId: "LOGGER",
      location: "debugLog.ts",
      message: "Failed to stringify payload",
      timestamp: Date.now(),
    });
  }
}

async function postHttp(urlStr: string, body: string): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          method: "POST",
          hostname: u.hostname,
          port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80,
          path: u.pathname + (u.search || ""),
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body, "utf8"),
            "X-Debug-Session-Id": SESSION_ID,
          },
        },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => resolve());
      req.write(body);
      req.end();
    } catch {
      resolve();
    }
  });
}

async function appendLocalNdjson(body: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
    await fs.appendFile(LOG_PATH, body + "\n", "utf8");
  } catch {
    // ignore
  }
}

/**
 * Best-effort debug logger for this session.
 * Never throws; prefers HTTP ingest, falls back to local NDJSON append.
 */
export function debugLog(payload: Omit<Payload, "sessionId" | "timestamp"> & {
  data?: Record<string, unknown>;
  timestamp?: number;
}): void {
  const full: Payload = {
    sessionId: SESSION_ID,
    timestamp: payload.timestamp ?? Date.now(),
    runId: payload.runId,
    hypothesisId: payload.hypothesisId,
    location: payload.location,
    message: payload.message,
    data: payload.data,
  };
  const body = safeStringify(full);

  void (async () => {
    try {
      const f = (globalThis as unknown as { fetch?: Function }).fetch;
      if (typeof f === "function") {
        await (f as any)(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Debug-Session-Id": SESSION_ID,
          },
          body,
        });
        return;
      }
      await postHttp(ENDPOINT, body);
    } catch {
      // ignore
    } finally {
      // Always keep a local breadcrumb if HTTP ingest is unavailable.
      await appendLocalNdjson(body);
    }
  })();
}

