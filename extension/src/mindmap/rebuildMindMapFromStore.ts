import { conceptTrieMergePath, listRecords, readRecord } from "../store/sessionStore";
import { sanitizeSessionRecord } from "../store/sanitizeRecords";
import {
  buildConceptMergeWithOntology,
  loadSegmentEquivalencesForRecords,
} from "../store/conceptMergeContext";
import { buildOutlineMindMap } from "./buildOutlineMindMap";
import type { SessionMeta } from "./origin";
import type { OutputLanguage } from "../llm/promptLanguage";
import type { MindMapRoot } from "../transcript/types";
import type { MergeRecord } from "../store/storeTypes";

export function resolveProjectSlugFromMindMap(
  mindMap: MindMapRoot | undefined
): string | undefined {
  const refs = mindMap?.data.origin?.refs;
  if (!refs?.length) {
    return undefined;
  }
  return refs[0]?.projectSlug;
}

export async function rebuildProjectMergeFromStore(
  storeDir: string,
  projectSlug: string
): Promise<MergeRecord | undefined> {
  const all = await listRecords(storeDir);
  const projectRecords = all.filter((r) => r.meta.projectSlug === projectSlug);
  if (!projectRecords.length) {
    return undefined;
  }
  const sanitized = await Promise.all(projectRecords.map((r) => sanitizeSessionRecord(r)));
  const first = sanitized[0];
  if (!first) {
    return undefined;
  }
  const llmOpts = {
    providerId: first.meta.llm.provider,
    model: first.meta.llm.model,
    hostId: first.meta.hostId,
    outputLanguage: first.meta.outputLanguage as OutputLanguage | undefined,
  };
  const ctx = await loadSegmentEquivalencesForRecords(storeDir, sanitized, llmOpts);
  return buildConceptMergeWithOntology(sanitized, { projectSlug }, ctx);
}

export async function rebuildSingleSessionMindMapFromStore(
  storeDir: string,
  projectSlug: string,
  sessionId: string
): Promise<MindMapRoot | undefined> {
  const record = await readRecord(storeDir, projectSlug, sessionId);
  if (!record?.sessionAnalysis?.outline) {
    return undefined;
  }
  const sanitized = await sanitizeSessionRecord(record);
  const analysis = sanitized.sessionAnalysis;
  if (!analysis?.outline) {
    return undefined;
  }
  const sessionMeta: SessionMeta = {
    sessionId: sanitized.meta.sessionId,
    projectSlug: sanitized.meta.projectSlug,
    projectPath: sanitized.meta.projectPath,
    sessionLabel: sanitized.meta.sessionLabel,
    transcriptPath: sanitized.meta.transcriptPath,
  };
  return buildOutlineMindMap(
    analysis.outline,
    sanitized.meta.sessionLabel,
    sessionMeta,
    analysis.codeReferences ?? [],
    sanitized.meta.projectPath,
    sanitized.meta.outputLanguage
  );
}

export { conceptTrieMergePath };
