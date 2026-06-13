import { escapeTabularCell, formatRow, formatTable } from "./promptReattachTabular";
import type {
  MergeOutlineNode,
  MergeSessionAnalysisInput,
  MergeSessionInputNode,
  MergeSessionInputSession,
} from "./mergeSessionAnalysisInput";
import type { SegmentEquivalence } from "./types";

export type MergeTabularSchema = {
  name: string;
  columns: string[];
};

/** Input tables for M-merge session-analysis LLM prompt. */
export const MERGE_INPUT_SCHEMAS: MergeTabularSchema[] = [
  {
    name: "mergeMeta",
    columns: ["mergeMode", "snapshotSessionId"],
  },
  {
    name: "sessions",
    columns: [
      "sessionId",
      "label",
      "role",
      "domains",
      "outlineTitle",
      "outlineSummary",
      "frozenTopRootKeys",
      "frozenDomains",
    ],
  },
  {
    name: "nodes",
    columns: [
      "sessionId",
      "key",
      "label",
      "domainKeys",
      "parentKeys",
      "childKeys",
      "aliases",
      "evidence",
    ],
  },
  {
    name: "outlineRows",
    columns: ["sessionId", "row", "parentRow", "depth", "title", "summary", "conceptPath"],
  },
  {
    name: "segmentEquivalences",
    columns: ["sessionId", "canonical", "aliases", "scopePrefix", "confidence"],
  },
];

const SCHEMA_HEADER = [
  "## 输入 schema（M-merge TAB 表）",
  "",
  "- 分隔符：字段用 TAB；多值用 |；conceptPath 段用 /；多条 evidence 用 ;;",
  "- 空字段留空；`### 表名` 下方首行为列名（TAB），其后每行一条记录",
  "- **mergeMeta**：mergeMode（full|delta）、snapshotSessionId（delta 时虚拟快照会话 id）",
  "- **sessions**：每会话一行；role=snapshot|batch|library；domains=该会话顶层领域 key（|）；outlineTitle/outlineSummary=大纲标题与摘要；仅 snapshot 行填写 frozenTopRootKeys、frozenDomains（|）",
  "- **nodes**：概念 DAG；domainKeys/parentKeys/childKeys/aliases 为 | 分隔；parentKeys 为空=顶根；childKeys 为直接子 key，沿 nodes 表递归 childKeys 得**子孙子树**",
  "- **outlineRows**：该会话 2–4 层大纲；同 sessionId 内 parentRow 为空且 depth=0 为顶枝；parentRow=父行的 row 编号；有 conceptPath（/ 分段）的行为叶子；中间层可有 title/summary 而无 conceptPath",
  "- **segmentEquivalences**：path 段同义；scopePrefix 限定成立语境（/ 分段，空=根级）",
  "",
];

function joinMulti(values: string[] | undefined): string {
  if (!values?.length) {
    return "";
  }
  return values.map((v) => escapeTabularCell(v)).join("|");
}

function joinPath(segments: string[]): string {
  return segments.map((s) => escapeTabularCell(s)).join("/");
}

function joinEvidence(values: string[] | undefined): string {
  if (!values?.length) {
    return "";
  }
  return values.map((v) => escapeTabularCell(v)).join(";;");
}

function schemaByName(name: string): MergeTabularSchema {
  const schema = MERGE_INPUT_SCHEMAS.find((s) => s.name === name);
  if (!schema) {
    throw new Error(`unknown merge tabular schema: ${name}`);
  }
  return schema;
}

function optionalTable(name: string, rows: string[][]): string {
  if (!rows.length) {
    return "";
  }
  const schema = schemaByName(name);
  return formatTable(name, schema.columns, rows);
}

function requiredTable(name: string, rows: string[][]): string {
  const schema = schemaByName(name);
  if (!rows.length) {
    return [`### ${name}`, formatRow(schema.columns)].join("\n");
  }
  return formatTable(name, schema.columns, rows);
}

export function formatMergeInputSchema(): string {
  const lines = [...SCHEMA_HEADER];
  for (const schema of MERGE_INPUT_SCHEMAS) {
    lines.push(`${schema.name}: ${schema.columns.join(", ")}`);
  }
  return lines.join("\n");
}

function mergeMetaRow(input: MergeSessionAnalysisInput): string[][] {
  return [[input.mergeMode, input.snapshotSessionId ?? ""]];
}

function sessionRows(sessions: MergeSessionInputSession[]): string[][] {
  return sessions.map((s) => [
    s.sessionId,
    s.label,
    s.role,
    joinMulti(s.domains),
    s.outline.title,
    s.outline.summary ?? "",
    joinMulti(s.frozenTopRootKeys),
    joinMulti(s.frozenDomains),
  ]);
}

function nodeRows(sessions: MergeSessionInputSession[]): string[][] {
  const rows: string[][] = [];
  for (const session of sessions) {
    for (const node of session.nodes) {
      rows.push(nodeRow(session.sessionId, node));
    }
  }
  return rows;
}

function nodeRow(sessionId: string, node: MergeSessionInputNode): string[] {
  return [
    sessionId,
    node.key,
    node.label,
    joinMulti(node.domainKeys),
    joinMulti(node.parentKeys),
    joinMulti(node.childKeys),
    joinMulti(node.aliases),
    joinEvidence(node.evidence),
  ];
}

function flattenOutlineNodes(
  sessionId: string,
  nodes: MergeOutlineNode[],
  depth: number,
  parentRow: string,
  rows: string[][],
  rowCounter: { n: number }
): void {
  for (const node of nodes) {
    const rowId = rowCounter.n;
    rowCounter.n += 1;
    rows.push([
      sessionId,
      String(rowId),
      parentRow,
      String(depth),
      node.title,
      node.summary ?? "",
      node.conceptPath?.length ? joinPath(node.conceptPath) : "",
    ]);
    if (node.children?.length) {
      flattenOutlineNodes(sessionId, node.children, depth + 1, String(rowId), rows, rowCounter);
    }
  }
}

function outlineRows(sessions: MergeSessionInputSession[]): string[][] {
  const rows: string[][] = [];
  for (const session of sessions) {
    const counter = { n: 0 };
    flattenOutlineNodes(session.sessionId, session.outline.tree, 0, "", rows, counter);
  }
  return rows;
}

function segmentEquivalenceRows(sessions: MergeSessionInputSession[]): string[][] {
  const rows: string[][] = [];
  for (const session of sessions) {
    for (const eq of (session.segmentEquivalences ?? []) as SegmentEquivalence[]) {
      rows.push([
        session.sessionId,
        eq.canonical,
        joinMulti(eq.aliases),
        joinMulti(eq.scope?.pathPrefix ?? []),
        eq.confidence != null ? String(eq.confidence) : "",
      ]);
    }
  }
  return rows;
}

/** TAB tables + schema header for M-merge LLM input. */
export function buildMergeSessionAnalysisTabularInput(input: MergeSessionAnalysisInput): string {
  const parts = [
    formatMergeInputSchema(),
    "",
    requiredTable("mergeMeta", mergeMetaRow(input)),
    requiredTable("sessions", sessionRows(input.sessions)),
    requiredTable("nodes", nodeRows(input.sessions)),
    requiredTable("outlineRows", outlineRows(input.sessions)),
    optionalTable("segmentEquivalences", segmentEquivalenceRows(input.sessions)),
  ].filter(Boolean);
  return parts.join("\n\n");
}

/** Legacy JSON body size (for regression: tabular should be smaller at scale). */
export function estimateMergeJsonInputBytes(input: MergeSessionAnalysisInput): number {
  return Buffer.byteLength(JSON.stringify(input), "utf8");
}

export const __testing = {
  nodeRow,
  flattenOutlineNodes,
  outlineRows,
};
