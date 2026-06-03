import type { NumberedReparentChain, NumberedSubtreeNode, ReattachCatalogNode } from "./reattachNodeCatalog";
import type { ConceptContextForMerge } from "../store/storeTypes";
import type {
  RootChildSynonymHint,
  TopBranchSynonymHint,
  TrieReparentInput,
} from "./trieReparentInput";
import type {
  DuplicateTopRootHint,
  ListedChildCollapseHint,
  OntologySubordinateHint,
  PrefixSubordinateHint,
} from "./reattachStructuralHints";
import type { SegmentEquivalence } from "./types";

export type TabularSchema = {
  name: string;
  columns: string[];
};

/** All input tables referenced by the reattach prompt. */
export const REATTACH_INPUT_SCHEMAS: TabularSchema[] = [
  {
    name: "topBranchSynonymHints",
    columns: ["canonical", "aliases", "branches", "confidence"],
  },
  {
    name: "rootChildSynonymHints",
    columns: [
      "branchFrom",
      "childSegment",
      "canonical",
      "aliases",
      "scopePathPrefix",
      "confidence",
    ],
  },
  {
    name: "duplicateTopRoots",
    columns: [
      "parentChainFrom",
      "duplicateTopFrom",
      "parentNodeId",
      "duplicateTopNodeId",
    ],
  },
  {
    name: "listedChildCollapses",
    columns: ["chainFrom", "childSegment", "canonical", "aliases"],
  },
  {
    name: "ontologySubordinates",
    columns: ["specialistFrom", "hubFrom", "hubNodeId", "specialistNodeId"],
  },
  {
    name: "prefixSubordinates",
    columns: ["specialistFrom", "hubFrom", "hubNodeId", "specialistNodeId"],
  },
  {
    name: "nodeCatalog",
    columns: ["id", "path", "segment", "label", "depth", "chainIndex", "isTopRoot"],
  },
  {
    name: "chainMeta",
    columns: [
      "chainIndex",
      "rootNodeId",
      "from",
      "label",
      "topicCount",
      "childSegmentIds",
      "pathSamples",
      "keywords",
    ],
  },
  {
    name: "treeEdges",
    columns: ["parentId", "childId", "segment", "label", "topicCount"],
  },
  {
    name: "segmentEquivalences",
    columns: ["canonical", "aliases", "scopePrefix", "confidence"],
  },
  {
    name: "conceptContexts",
    columns: [
      "key",
      "label",
      "domainKeys",
      "parentKeys",
      "childKeys",
      "evidence",
      "sessionId",
    ],
  },
  {
    name: "ontologyNodes",
    columns: ["key", "label", "aliases", "parentKeys", "childKeys", "evidence"],
  },
];

const SCHEMA_HEADER = [
  "## 输入 schema（本 prompt 通用）",
  "",
  "- 分隔符：字段用 TAB；多值用 |；路径段用 /；多条 evidence 用 ;;",
  "- 空字段留空；表名下方首行为列名（TAB 分隔），后续每行一条记录",
  "",
];

/** Escape a cell for TAB-separated tables (quote if needed). */
export function escapeTabularCell(value: string | number | undefined | null): string {
  if (value === undefined || value === null) {
    return "";
  }
  const s = String(value);
  if (!/[|\t\n\r"]/.test(s)) {
    return s;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

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

function formatRow(cells: (string | number | undefined | null)[]): string {
  return cells.map((c) => escapeTabularCell(c)).join("\t");
}

export function formatInputSchema(): string {
  const lines = [...SCHEMA_HEADER];
  for (const schema of REATTACH_INPUT_SCHEMAS) {
    lines.push(`${schema.name}: ${schema.columns.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatTable(
  name: string,
  columns: string[],
  rows: string[][]
): string {
  if (!rows.length) {
    return "";
  }
  return [
    `### ${name}`,
    formatRow(columns),
    ...rows.map((row) => formatRow(row)),
  ].join("\n");
}

function formatConceptContextsForTabular(
  contexts: ConceptContextForMerge[]
): string[][] {
  return contexts.slice(0, 120).map((c) => [
    c.key,
    c.label,
    joinMulti(c.domainKeys),
    joinMulti(c.parentKeys),
    joinMulti(c.childKeys),
    joinEvidence(c.evidence.slice(0, 4)),
    c.sessionId,
  ]);
}

function catalogNodeRows(nodes: ReattachCatalogNode[]): string[][] {
  return nodes.map((n) => [
    n.id,
    joinPath(n.path),
    n.segment,
    n.label,
    n.depth,
    n.chainIndex ?? "",
    n.isTopRoot ? 1 : 0,
  ]);
}

function encodePathSamples(samples: string[][]): string {
  if (!samples.length) {
    return "";
  }
  return samples.map((sample) => joinPath(sample)).join("|");
}

function chainMetaRows(chains: NumberedReparentChain[]): string[][] {
  return chains.map((c) => [
    c.chainIndex,
    c.rootNodeId,
    c.from,
    c.label,
    c.topicCount,
    joinMulti(c.childSegmentIds),
    encodePathSamples(c.pathSamples),
    joinMulti(c.keywords),
  ]);
}

/** Count parent→child edges in numbered subtrees (for tests). */
export function countNumberedTreeEdges(chains: NumberedReparentChain[]): number {
  let total = 0;
  const walk = (node: NumberedSubtreeNode): void => {
    for (const child of node.children) {
      total += 1;
      walk(child);
    }
  };
  for (const chain of chains) {
    walk(chain.tree);
  }
  return total;
}

function treeEdgesFromNode(
  node: NumberedSubtreeNode,
  parentId: string,
  out: string[][]
): void {
  for (const child of node.children) {
    out.push([
      parentId,
      child.id,
      child.segment,
      child.label,
      child.topicCount,
    ]);
    treeEdgesFromNode(child, child.id, out);
  }
}

function treeEdgeRows(chains: NumberedReparentChain[]): string[][] {
  const rows: string[][] = [];
  for (const chain of chains) {
    treeEdgesFromNode(chain.tree, chain.rootNodeId, rows);
  }
  return rows;
}

function segmentEquivalenceRows(equivalences: SegmentEquivalence[]): string[][] {
  return equivalences.slice(0, 24).map((eq) => [
    eq.canonical,
    joinMulti(eq.aliases),
    joinMulti(eq.scope.pathPrefix),
    eq.confidence ?? "",
  ]);
}

function topBranchSynonymRows(hints: TopBranchSynonymHint[]): string[][] {
  return hints.map((h) => [
    h.canonical,
    joinMulti(h.aliases),
    joinMulti(h.branches),
    h.confidence ?? "",
  ]);
}

function rootChildSynonymRows(hints: RootChildSynonymHint[]): string[][] {
  return hints.map((h) => [
    h.branchFrom,
    h.childSegment,
    h.canonical,
    joinMulti(h.aliases),
    joinMulti(h.scopePathPrefix),
    h.confidence ?? "",
  ]);
}

function duplicateTopRootRows(hints: DuplicateTopRootHint[]): string[][] {
  return hints.map((h) => [
    h.parentChainFrom,
    h.duplicateTopFrom,
    h.parentNodeId ?? "",
    h.duplicateTopNodeId ?? "",
  ]);
}

function listedChildCollapseRows(hints: ListedChildCollapseHint[]): string[][] {
  return hints.map((h) => [
    h.chainFrom,
    h.childSegment,
    h.canonical,
    joinMulti(h.aliases),
  ]);
}

function ontologySubordinateRows(hints: OntologySubordinateHint[]): string[][] {
  return hints.map((h) => [
    h.specialistFrom,
    h.hubFrom,
    h.hubNodeId ?? "",
    h.specialistNodeId ?? "",
  ]);
}

function prefixSubordinateRows(hints: PrefixSubordinateHint[]): string[][] {
  return hints.map((h) => [
    h.specialistFrom,
    h.hubFrom,
    h.hubNodeId ?? "",
    h.specialistNodeId ?? "",
  ]);
}

function ontologyNodeRows(
  nodes: TrieReparentInput["nodes"]
): string[][] {
  return nodes.slice(0, 48).map((n) => [
    n.key,
    n.label,
    joinMulti(n.aliases),
    joinMulti(n.parentKeys),
    joinMulti(n.childKeys),
    joinEvidence(n.evidence?.slice(0, 4)),
  ]);
}

function schemaByName(name: string): TabularSchema {
  const schema = REATTACH_INPUT_SCHEMAS.find((s) => s.name === name);
  if (!schema) {
    throw new Error(`unknown tabular schema: ${name}`);
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

/** Always emit column header; data rows may be empty (e.g. treeEdges with flat chains). */
function requiredTable(name: string, rows: string[][]): string {
  const schema = schemaByName(name);
  if (!rows.length) {
    return [`### ${name}`, formatRow(schema.columns)].join("\n");
  }
  return formatTable(name, schema.columns, rows);
}

/** Hint tables for the ontology / structure section. */
export function buildReattachHintTables(input: TrieReparentInput): string {
  const parts: string[] = [];
  const sh = input.structuralHints;

  if (input.topBranchSynonymHints.length) {
    parts.push(
      "### 并列顶级链同义线索（segmentEquivalences，须结合语境验证）",
      optionalTable(
        "topBranchSynonymHints",
        topBranchSynonymRows(input.topBranchSynonymHints)
      )
    );
  }
  if (input.rootChildSynonymHints.length) {
    parts.push(
      "### 链根与其直接子段同义线索（须结合语境验证）",
      optionalTable(
        "rootChildSynonymHints",
        rootChildSynonymRows(input.rootChildSynonymHints)
      )
    );
  }
  if (sh.duplicateTopRoots.length) {
    parts.push(
      "### 并列顶根重复（某链 childSegments 已含另一顶根）",
      "→ 用 `merge_synonym`：`sourceNodeId` = duplicateTopNodeId，`targetNodeId` = parentNodeId。",
      optionalTable("duplicateTopRoots", duplicateTopRootRows(sh.duplicateTopRoots))
    );
  }
  if (sh.listedChildCollapses.length) {
    parts.push(
      "### 链内根/子段同义（segmentEquivalences 已支持折叠）",
      "→ 勿保留「链根 → 同义子段」连续两层；并列顶根用 merge_synonym（按节点 id）。",
      optionalTable(
        "listedChildCollapses",
        listedChildCollapseRows(sh.listedChildCollapses)
      )
    );
  }
  if (sh.ontologySubordinates.length) {
    parts.push(
      "### ontology 下位关系（parentKeys）",
      "→ `attach_under`：`sourceNodeId` = specialistNodeId，`targetNodeIds` = [hubNodeId, specialistNodeId]。",
      optionalTable(
        "ontologySubordinates",
        ontologySubordinateRows(sh.ontologySubordinates)
      )
    );
  }
  if (sh.prefixSubordinates.length) {
    parts.push(
      "### segment key 前缀下位（专精顶根 extends hub key）",
      "→ `attach_under`：`sourceNodeId` = specialistNodeId，`targetNodeIds` = [hubNodeId, specialistNodeId]。",
      "例：android-app、android-framework 与 android 并列时，须挂到 android 下，禁止保留为并列顶根。",
      optionalTable(
        "prefixSubordinates",
        prefixSubordinateRows(sh.prefixSubordinates)
      )
    );
  }

  return parts.filter(Boolean).join("\n");
}

/** Main input tables (nodeCatalog, chains, contexts, …). */
export function buildReattachDataTables(input: TrieReparentInput): string {
  const catalog = input.nodeCatalog;
  const parts = [
    requiredTable("nodeCatalog", catalogNodeRows(catalog.nodes)),
    requiredTable("chainMeta", chainMetaRows(catalog.numberedChains)),
    requiredTable("treeEdges", treeEdgeRows(catalog.numberedChains)),
    optionalTable(
      "segmentEquivalences",
      segmentEquivalenceRows(input.segmentEquivalences)
    ),
    optionalTable(
      "conceptContexts",
      formatConceptContextsForTabular(input.conceptContexts)
    ),
    optionalTable("ontologyNodes", ontologyNodeRows(input.nodes)),
  ].filter(Boolean);

  return parts.join("\n\n");
}

/** Schema + hint tables + data tables for the full tabular input block. */
export function buildReattachTabularInput(input: TrieReparentInput): {
  schema: string;
  hints: string;
  data: string;
} {
  const hints = buildReattachHintTables(input);
  return {
    schema: formatInputSchema(),
    hints,
    data: buildReattachDataTables(input),
  };
}

/** Byte size of JSON-encoded input blocks (for regression tests). */
export function estimateReattachJsonInputBytes(input: TrieReparentInput): number {
  const catalog = input.nodeCatalog;
  const contexts = input.conceptContexts.slice(0, 120).map((c) => ({
    key: c.key,
    label: c.label,
    domainKeys: c.domainKeys,
    parentKeys: c.parentKeys,
    childKeys: c.childKeys,
    evidence: c.evidence.slice(0, 4),
    sessionId: c.sessionId,
  }));
  const payload = {
    topBranchSynonymHints: input.topBranchSynonymHints,
    rootChildSynonymHints: input.rootChildSynonymHints,
    structuralHints: input.structuralHints,
    nodeCatalog: catalog.nodes,
    numberedChains: catalog.numberedChains,
    segmentEquivalences: input.segmentEquivalences.slice(0, 24),
    conceptContexts: contexts,
    ontologyNodes: input.nodes.slice(0, 48),
  };
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}
