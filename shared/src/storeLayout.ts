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

/**
 * Filenames for the MCP-server config files written by the extension / CLI
 * and read by the stdio MCP server. Centralized here to avoid drift between
 * the writer (core) and reader (mcp-server).
 */
export const MCP_CONFIG_FILES = {
  workspacePaths: "workspace-paths.json",
  repoPaths: "repo-paths.json",
  mode: "mcp-mode.json",
  locale: "mcp-locale.json",
} as const;
