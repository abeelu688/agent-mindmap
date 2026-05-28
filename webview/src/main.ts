import MindElixir, { type MindElixirInstance, type NodeObj } from "mind-elixir";
import "mind-elixir/style.css";
import "./styles.css";
import { readExportBootstrap } from "./exportBootstrap";
import { resolveOfflineJumpHref } from "./offlineJump";
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
import type { WebviewStrings } from "./uiContextMenu";

type ExtensionMessage =
  | { type: "setData"; data: MindMapNodeData }
  | { type: "setUi"; ui: MindMapUiOptions }
  | { type: "setLoading"; active: boolean; message?: string }
  | {
      type: "setStrings";
      strings: { loadingTitle: string; menu: WebviewStrings["menu"] };
    }
  | { type: "setBatchStatus"; status: BatchStatus };

type WebviewToExtensionMessage =
  | { type: "ready" }
  | { type: "log"; message: string }
  | { type: "nodeClicked"; origin: NodeOrigin; nodeLabel?: string }
  | { type: "updateUiSetting"; key: "preset" | "direction"; value: string }
  | { type: "requestDownload" }
  | { type: "requestApplyPendingUpdate" };

type BatchStatus = {
  total: number;
  processed: number;
  analyzed: number;
  cached: number;
  failed: number;
  batchNo: number;
  running: boolean;
  pendingUpdateBatchNo?: number;
};

type VsCodeApi = {
  postMessage(message: WebviewToExtensionMessage): void;
};

declare function acquireVsCodeApi(): VsCodeApi;

const exportBootstrap = readExportBootstrap();
const offlineMode = exportBootstrap !== undefined;

const vscode: VsCodeApi | undefined =
  !offlineMode && typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : undefined;

const container = document.getElementById("mindMapContainer");
const loadingEl = document.getElementById("mindmapLoading");
const loadingTitleEl = loadingEl?.querySelector(".mindmap-loading__title");
const loadingMessageEl = loadingEl?.querySelector(".mindmap-loading__message");
const batchStatusEl = document.getElementById("batchStatusBar");
const batchProgressEl = batchStatusEl?.querySelector(".batch-status__progress");
const batchDetailEl = batchStatusEl?.querySelector(".batch-status__detail");
const batchRefreshBtn = document.getElementById(
  "batchStatusRefresh"
) as HTMLButtonElement | null;

if (!container) {
  throw new Error("mindMapContainer not found");
}

function setLoadingOverlay(active: boolean, message?: string): void {
  if (!loadingEl) {
    return;
  }
  if (active) {
    loadingEl.classList.remove("mindmap-loading--hidden");
    loadingEl.hidden = false;
    if (loadingMessageEl) {
      loadingMessageEl.textContent = message?.trim() ? message : "";
    }
  } else {
    loadingEl.classList.add("mindmap-loading--hidden");
    loadingEl.hidden = true;
    if (loadingMessageEl) {
      loadingMessageEl.textContent = "";
    }
  }
}

let lastBatchStatus: BatchStatus | undefined;

function setBatchStatus(status: BatchStatus): void {
  lastBatchStatus = status;
  if (!batchStatusEl || !batchProgressEl || !batchDetailEl) {
    return;
  }

  if (status.total <= 0) {
    batchStatusEl.classList.add("batch-status--hidden");
    batchStatusEl.hidden = true;
    return;
  }

  batchStatusEl.classList.remove("batch-status--hidden");
  batchStatusEl.hidden = false;

  const pct =
    status.total > 0 ? Math.floor((status.processed / status.total) * 100) : 0;
  batchProgressEl.textContent = `${status.processed}/${status.total} (${pct}%)`;

  const parts: string[] = [];
  parts.push(`ok:${status.analyzed}`);
  parts.push(`cached:${status.cached}`);
  if (status.failed) {
    parts.push(`failed:${status.failed}`);
  }
  if (status.running) {
    parts.push("running");
  } else {
    parts.push("done");
  }
  if (status.pendingUpdateBatchNo !== undefined) {
    parts.push(`update:batch${status.pendingUpdateBatchNo}`);
  }
  batchDetailEl.textContent = parts.join(" · ");

  if (batchRefreshBtn) {
    const canRefresh = status.pendingUpdateBatchNo !== undefined;
    batchRefreshBtn.disabled = !canRefresh;
    batchRefreshBtn.classList.toggle(
      "batch-status__button--attention",
      canRefresh
    );
    batchRefreshBtn.title = canRefresh
      ? "Merge ready — click to update mind map"
      : "";
  }
}

let mind: MindElixirInstance | undefined;
let resizeRaf: number | undefined;
let onSelectNodes: ((nodes: NodeObj<NodeMetadata>[]) => void) | undefined;
let currentUi: MindMapUiOptions | undefined;
let pendingData: MindMapNodeData | undefined;
let lastRenderedData: MindMapNodeData | undefined;
let uiStrings: { loadingTitle: string; menu: WebviewStrings["menu"] } = {
  loadingTitle: "Generating mind map…",
  menu: {
    sectionTheme: "Theme",
    sectionDirection: "Layout direction",
    presetAuto: "Follow editor",
    presetDark: "Dark",
    presetLight: "Light",
    directionSide: "Both sides (right then left)",
    directionRight: "Right",
    directionLeft: "Left",
    download: "Download mind map & transcripts…",
  },
};

function applyStrings(next: typeof uiStrings): void {
  uiStrings = next;
  if (loadingTitleEl) {
    loadingTitleEl.textContent = uiStrings.loadingTitle;
  }
}

function postToExtension(message: WebviewToExtensionMessage): void {
  vscode?.postMessage(message);
}

function handleNodeSelection(
  nodes: NodeObj<NodeMetadata>[],
  picked: NodeObj<NodeMetadata> | undefined
): void {
  const withOrigin = nodes.filter((n) => readOriginFromNodeObj(n));
  const node =
    picked ??
    withOrigin[withOrigin.length - 1] ??
    nodes[nodes.length - 1];
  const origin = readOriginFromNodeObj(node);
  if (!origin) {
    const topic = node?.topic ?? "<unknown>";
    const label = topic.length > 50 ? topic.slice(0, 50) + "…" : topic;
    postToExtension({
      type: "log",
      message: `selectNodes: no origin on "${label}"`,
    });
    return;
  }

  if (offlineMode) {
    const href = resolveOfflineJumpHref(origin, node?.topic);
    if (href) {
      window.open(href, "_blank");
    }
    return;
  }

  postToExtension({
    type: "log",
    message: `selectNodes: forwarding ${origin.refs.length} ref(s)`,
  });
  postToExtension({
    type: "nodeClicked",
    origin,
    nodeLabel: node?.topic,
  });
}

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
    handleNodeSelection(nodes, picked);
  };
  instance.bus.addListener("selectNodes", onSelectNodes);
  postToExtension({ type: "log", message: "selectNodes listener bound" });
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
      postToExtension({
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
  setLoadingOverlay(false);
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

if (!offlineMode) {
  window.addEventListener("message", (event) => {
    const msg = event.data as ExtensionMessage;
    if (msg?.type === "setStrings" && msg.strings) {
      applyStrings(msg.strings);
      return;
    }
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
    if (msg?.type === "setLoading") {
      setLoadingOverlay(!!msg.active, msg.message);
      return;
    }
    if (msg?.type === "setBatchStatus" && msg.status) {
      setBatchStatus(msg.status);
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
}

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

if (!offlineMode) {
  container.addEventListener("contextmenu", (event) => {
    if (!isBlankCanvasTarget(event.target, container)) {
      return;
    }
    if (!currentUi) {
      return;
    }
    event.preventDefault();
    showUiContextMenu(
      event.clientX,
      event.clientY,
      currentUi,
      { menu: uiStrings.menu },
      (pick) => {
        postToExtension({
          type: "updateUiSetting",
          key: pick.key,
          value: pick.value,
        });
      },
      {
        showDownload: true,
        onDownload: () => {
          postToExtension({ type: "requestDownload" });
        },
      }
    );
  });

  // Ensure we have a title even before strings arrive.
  applyStrings(uiStrings);
  if (batchRefreshBtn) {
    batchRefreshBtn.addEventListener("click", () => {
      if (!lastBatchStatus?.pendingUpdateBatchNo) {
        return;
      }
      postToExtension({ type: "requestApplyPendingUpdate" });
    });
  }
  postToExtension({ type: "ready" });
} else if (exportBootstrap) {
  currentUi = exportBootstrap.ui;
  applyStrings(uiStrings);
  render(exportBootstrap.data);
}
