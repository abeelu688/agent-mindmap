export const STORE_LAYOUT = {
  schemaFile: "schema.json",
  indexFile: "index.json",
  sessionsDir: "sessions",
  mergesDir: "merges",
  mergeCacheDir: "merges/cache",
  deterministicFile: "merges/deterministic.json",
  conceptTrieFile: "merges/concept-trie.json",
  llmRefinedFile: "merges/llm-refined.json",
  ontologyDir: "ontology",
  ontologyIndexFile: "ontology/index.json",
  ontologyCacheDir: "ontology/cache",
  mcpIndexFile: ".mcp-index.json",
} as const;

export const MCP_INDEX_SCHEMA_VERSION = 1 as const;
