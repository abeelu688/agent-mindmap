import MindElixir, { type MindElixirInstance, type NodeObj } from "mind-elixir";
import "mind-elixir/style.css";
import "./styles.css";
import { assignSideDirectionsPreferRight } from "./sideLayout";
import { directionFromUi, resolveTheme } from "./theme";
import {
  readOriginFromNodeObj,
  toMindElixirData,
  type MindMapNodeData,
  type NodeMetadata,
  type NodeOrigin,
} from "./toMindElixir";
import { isBlankCanvasTarget, showUiContextMenu } from "./uiContextMenu";
import type { MindMapUiOptions } from "./uiTypes";

type ExtensionMessage =
  | { type: "setData"; data: MindMapNodeData }
  | { type: "setUi"; ui: MindMapUiOptions };

type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin; nodeLabel?: string }
  | { type: "updateUiSetting"; key: "preset" | "direction"; value: string };

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
let currentUi: MindMapUiOptions | undefined;
let pendingData: MindMapNodeData | undefined;
let lastRenderedData: MindMapNodeData | undefined;

function createMind(ui: MindMapUiOptions): MindElixirInstance {
  const instance = new MindElixir({
    el: container,
    direction: directionFromUi(ui),
    editable: false,
    toolBar: false,
    contextMenu: false,
    keypress: false,
    allowUndo: false,
    overflowHidden: false,
    alignment: "nodes",
    theme: resolveTheme(ui),
  });

  onSelectNodes = (nodes) => {
    const withOrigin = nodes.filter((n) => readOriginFromNodeObj(n));
    const picked =
      withOrigin[withOrigin.length - 1] ?? nodes[nodes.length - 1];
    const origin = readOriginFromNodeObj(picked);
    if (origin) {
      vscode.postMessage({
        type: "log",
        message: `selectNodes: forwarding ${origin.refs.length} ref(s)`,
      });
      vscode.postMessage({
        type: "nodeClicked",
        origin,
        nodeLabel: picked?.topic,
      });
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

function applyUi(ui: MindMapUiOptions): void {
  currentUi = ui;
  if (!mind) {
    return;
  }
  const nextDirection = directionFromUi(ui);
  const directionChanged = mind.direction !== nextDirection;
  mind.changeTheme(resolveTheme(ui), true);
  if (directionChanged) {
    mind.direction = nextDirection;
    try {
      mind.layout();
    } catch {
      // ignore
    }
  }
  handleResize();
}

function tryRender(): void {
  if (!pendingData || !currentUi) {
    return;
  }
  const data = pendingData;
  pendingData = undefined;
  render(data);
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
  if (!currentUi) {
    pendingData = data;
    return;
  }
  const ui = currentUi;
  const meiData = toMindElixirData(data);
  if (directionFromUi(ui) === 2) {
    assignSideDirectionsPreferRight(meiData.nodeData);
  }
  if (!mind) {
    mind = createMind(ui);
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
    applyUi(ui);
  }
  lastRenderedData = data;
  handleResize();
}

function rebuildMindFromLastData(): void {
  if (!lastRenderedData || !currentUi) {
    return;
  }
  const data = lastRenderedData;
  destroyMindMap();
  render(data);
}

window.addEventListener("message", (event) => {
  const msg = event.data as ExtensionMessage;
  if (msg?.type === "setUi" && msg.ui) {
    const prev = currentUi;
    currentUi = msg.ui;
    if (mind && prev && prev.direction !== msg.ui.direction) {
      rebuildMindFromLastData();
    } else {
      applyUi(msg.ui);
    }
    tryRender();
    return;
  }
  if (msg?.type === "setData" && msg.data) {
    if (!currentUi) {
      pendingData = msg.data;
      return;
    }
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

container.addEventListener("contextmenu", (event) => {
  if (!isBlankCanvasTarget(event.target, container)) {
    return;
  }
  if (!currentUi) {
    return;
  }
  event.preventDefault();
  showUiContextMenu(event.clientX, event.clientY, currentUi, (pick) => {
    vscode.postMessage({
      type: "updateUiSetting",
      key: pick.key,
      value: pick.value,
    });
  });
});

vscode.postMessage({ type: "ready" });
