import type { MindMapNodeData } from "./toMindElixir";
import type { MindMapUiOptions } from "./uiTypes";

export type AgentMindMapExportBootstrap = {
  data: MindMapNodeData;
  ui: MindMapUiOptions;
};

declare global {
  interface Window {
    __AGENT_MINDMAP_EXPORT__?: AgentMindMapExportBootstrap;
  }
}

export function readExportBootstrap():
  | AgentMindMapExportBootstrap
  | undefined {
  return window.__AGENT_MINDMAP_EXPORT__;
}
