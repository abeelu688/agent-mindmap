/** VS Code stub for headless multilingual fixture HTML runs. */
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OUT = path.join(REPO_ROOT, "test/fixtures/multilingual-jsonl/html-out");

function envPath(key, fallback) {
  const raw = process.env[key];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function htmlOutDir() {
  return envPath("AGENT_MINDMAP_HTML_OUT_DIR", DEFAULT_OUT);
}

function storeDir() {
  return envPath("AGENT_MINDMAP_STORE_DIR", path.join(htmlOutDir(), ".store"));
}

function dumpIo() {
  return process.env.AGENT_MINDMAP_DUMP_IO === "1";
}

const STATIC_CONFIG = {
  host: "cursor",
  "llm.provider": "auto",
  "llm.promptLanguage": "auto",
  cacheLlmResult: true,
  "library.enabled": true,
  "library.batchRefineOntology": true,
  "library.batchFinalRefine": true,
  "library.mergeMode": "delta",
  "merge.autoRebuildDeterministic": true,
  maxTopics: 6,
  maxItemsPerTopic: 6,
  "merge.llm.maxTopics": 8,
  "merge.llm.maxItemsPerTopic": 6,
  includeToolCalls: true,
  maxConclusionItems: 8,
  "ui.preset": "light",
  "ui.direction": "side",
};

function getConfigValue(key, defaultValue) {
  switch (key) {
    case "storeDir":
      return storeDir();
    case "llm.provider": {
      const override = process.env.AGENT_MINDMAP_LLM_PROVIDER?.trim();
      if (override === "cursor-cli" || override === "claude-cli" || override === "auto") {
        return override;
      }
      return STATIC_CONFIG["llm.provider"];
    }
    case "llm.cliPath":
      return process.env.AGENT_MINDMAP_LLM_CLI_PATH?.trim() || "";
    case "llm.model":
      return process.env.AGENT_MINDMAP_LLM_MODEL?.trim() || "";
    case "llm.dumpIo":
      return dumpIo();
    case "llm.dumpDir":
      return path.join(htmlOutDir(), "llm-dumps");
    case "llm.cacheDir":
      return path.join(storeDir(), "llm-cache");
    default:
      if (Object.prototype.hasOwnProperty.call(STATIC_CONFIG, key)) {
        return STATIC_CONFIG[key];
      }
      return defaultValue;
  }
}

const globalState = new Map();
const workspaceState = new Map();

module.exports = {
  workspace: {
    workspaceFolders: undefined,
    getConfiguration(section) {
      return {
        get(key, defaultValue) {
          if (section !== "agentMindmap") {
            return defaultValue;
          }
          return getConfigValue(key, defaultValue);
        },
      };
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showQuickPick: async () => undefined,
  },
  Uri: {
    file: (p) => ({ fsPath: p }),
  },
  commands: {
    executeCommand: async () => undefined,
  },
  env: {
    language: "en",
    appName: "Node",
    clipboard: { writeText: async () => undefined },
    openExternal: async () => true,
  },
  ExtensionContext: function ExtensionContext() {},
  extensions: { getExtension: () => undefined },
  ExtensionMode: { Production: 1 },
  version: "0.0.0",
  __createContext(extensionPath) {
    return {
      extensionUri: { fsPath: extensionPath },
      extensionPath,
      globalStorageUri: { fsPath: path.join(storeDir(), "global-storage") },
      storageUri: { fsPath: path.join(storeDir(), "workspace-storage") },
      subscriptions: [],
      globalState: {
        get: (key, defaultValue) =>
          globalState.has(key) ? globalState.get(key) : defaultValue,
        update: async (key, value) => {
          globalState.set(key, value);
        },
      },
      workspaceState: {
        get: (key, defaultValue) =>
          workspaceState.has(key) ? workspaceState.get(key) : defaultValue,
        update: async (key, value) => {
          workspaceState.set(key, value);
        },
      },
    };
  },
};
