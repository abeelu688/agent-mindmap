import MindElixir, {
  DARK_THEME,
  type MindElixirInstance,
  type NodeObj,
} from "mind-elixir";
import "mind-elixir/style.css";
import "./styles.css";
import {
  readOriginFromNodeObj,
  toMindElixirData,
  type MindMapNodeData,
  type NodeMetadata,
  type NodeOrigin,
} from "./toMindElixir";

type ExtensionMessage = {
  type: "setData";
  data: MindMapNodeData;
};

type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin };

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtensionMessage): void;
};

const vscode = acquireVsCodeApi();
const container = document.getElementById("mindMapContainer");

if (!container) {
  throw new Error("mindMapContainer not found");
}

let mind: MindElixirInstance | undefined;
let resizeRaf: number | undefined;
let onSelectNodes: ((nodes: NodeObj<NodeMetadata>[]) => void) | undefined;

function vscodeTheme(): typeof DARK_THEME {
  const theme = { ...DARK_THEME, cssVar: { ...DARK_THEME.cssVar } };
  const bg =
    getComputedStyle(document.documentElement).getPropertyValue(
      "--vscode-editor-background"
    ) || "#1e1e1e";
  const fg =
    getComputedStyle(document.documentElement).getPropertyValue(
      "--vscode-editor-foreground"
    ) || "#cccccc";
  const accent =
    getComputedStyle(document.documentElement).getPropertyValue(
      "--vscode-focusBorder"
    ) || "#007fd4";
  theme.cssVar["--bgcolor"] = bg.trim() || "#1e1e1e";
  theme.cssVar["--color"] = fg.trim() || "#cccccc";
  theme.cssVar["--selected"] = accent.trim() || "#007fd4";
  theme.cssVar["--root-color"] = fg.trim() || "#cccccc";
  theme.cssVar["--root-bgcolor"] = bg.trim() || "#1e1e1e";
  theme.cssVar["--main-color"] = fg.trim() || "#cccccc";
  theme.cssVar["--main-bgcolor"] = bg.trim() || "#1e1e1e";
  return theme;
}

function createMind(): MindElixirInstance {
  const instance = new MindElixir({
    el: container,
    direction: MindElixir.SIDE,
    editable: false,
    toolBar: false,
    contextMenu: false,
    keypress: false,
    allowUndo: false,
    overflowHidden: false,
    alignment: "nodes",
    theme: vscodeTheme(),
  });

  onSelectNodes = (nodes) => {
    const picked =
      nodes.find((n) => readOriginFromNodeObj(n)) ?? nodes[nodes.length - 1];
    const origin = readOriginFromNodeObj(picked);
    if (origin) {
      vscode.postMessage({
        type: "log",
        message: `selectNodes: forwarding ${origin.refs.length} ref(s)`,
      });
      vscode.postMessage({ type: "nodeClicked", origin });
      return;
    }
    const topic = picked?.topic ?? "<unknown>";
    const label = topic.length > 50 ? topic.slice(0, 50) + "…" : topic;
    vscode.postMessage({
      type: "log",
      message: `selectNodes: no origin on "${label}"`,
    });
  };
  instance.bus.addListener("selectNodes", onSelectNodes);
  vscode.postMessage({ type: "log", message: "selectNodes listener bound" });
  return instance;
}

function destroyMindMap(): void {
  if (mind && onSelectNodes) {
    try {
      mind.bus.removeListener("selectNodes", onSelectNodes);
    } catch {
      // ignore
    }
  }
  onSelectNodes = undefined;
  try {
    mind?.destroy();
  } catch {
    // ignore
  }
  mind = undefined;
  container.innerHTML = "";
}

function handleResize(): void {
  if (!mind) {
    return;
  }
  if (resizeRaf !== undefined) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = undefined;
    try {
      mind?.scaleFit();
    } catch {
      try {
        mind?.toCenter();
      } catch {
        // ignore
      }
    }
  });
}

function render(data: MindMapNodeData): void {
  const meiData = toMindElixirData(data);
  if (!mind) {
    mind = createMind();
    const err = mind.init(meiData);
    if (err) {
      vscode.postMessage({
        type: "log",
        message: `mind.init failed: ${String(err)}`,
      });
    }
  } else {
    mind.refresh(meiData);
    mind.clearHistory?.();
  }
  handleResize();
}

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  if (msg?.type === "setData" && msg.data) {
    render(msg.data);
  }
});

window.addEventListener("resize", handleResize);

if (typeof ResizeObserver !== "undefined" && container) {
  const observer = new ResizeObserver(() => handleResize());
  observer.observe(container);
  if (container.parentElement) {
    observer.observe(container.parentElement);
  }
  observer.observe(document.body);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    handleResize();
  }
});

vscode.postMessage({ type: "ready" });
