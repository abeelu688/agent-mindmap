import MindMap from "simple-mind-map";
import "simple-mind-map/dist/simpleMindMap.esm.css";
import "./styles.css";

type NodeOriginRef = {
  sessionId: string;
  projectSlug: string;
  projectPath?: string;
  sessionLabel: string;
  transcriptPath: string;
  turnIndex?: number;
};

type NodeOrigin = {
  refs: NodeOriginRef[];
};

type MindMapNodeData = {
  data: { text: string; expand?: boolean; origin?: NodeOrigin };
  children?: MindMapNodeData[];
};

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

let mindMap: InstanceType<typeof MindMap> | undefined;
let resizeRaf: number | undefined;

function handleResize(): void {
  if (!mindMap) {
    return;
  }
  if (resizeRaf !== undefined) {
    cancelAnimationFrame(resizeRaf);
  }
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = undefined;
    try {
      mindMap?.resize();
    } catch {
      // ignore
    }
    try {
      mindMap?.view?.fit?.();
    } catch {
      // ignore
    }
  });
}

function destroyMindMap(): void {
  if (!mindMap) {
    return;
  }
  try {
    // Explicitly unbind any listeners we attached. simple-mind-map's
    // destroy() *should* clean these up but the lib has been observed to
    // leak `node_click` subscriptions across destroy+recreate cycles,
    // which doubles every click. Cheap insurance.
    (mindMap as unknown as { off?: (event: string) => void }).off?.(
      "node_click"
    );
  } catch {
    // ignore
  }
  try {
    // simple-mind-map exposes `destroy()`; if it isn't available for some
    // reason fall back to clearing the container DOM by hand.
    (mindMap as unknown as { destroy?: () => void }).destroy?.();
  } catch {
    // ignore
  }
  mindMap = undefined;
  if (container) {
    container.innerHTML = "";
  }
}

function render(data: MindMapNodeData): void {
  // simple-mind-map's setData only swaps the data tree; it doesn't clear the
  // previously rendered SVG layers. When the panel receives a second `setData`
  // (e.g. opening the latest session twice in a row, or auto-refresh) the new
  // tree gets drawn on top of the old one. Destroy + recreate is the only
  // reliable way to guarantee a clean canvas.
  destroyMindMap();
  if (!container) {
    return;
  }
  mindMap = new MindMap({
    el: container,
    data,
    readonly: true,
    fit: true,
    isExpandByDefault: true,
  } as ConstructorParameters<typeof MindMap>[0]);

  // simple-mind-map emits `node_click` on every node tap. We forward the
  // (origin) ride-along to the extension so it can run the jump flow.
  try {
    (mindMap as unknown as {
      on(event: string, cb: (node: unknown) => void): void;
    }).on("node_click", (node) => {
      const origin = readOrigin(node);
      if (origin) {
        vscode.postMessage({
          type: "log",
          message: `node_click: forwarding ${origin.refs.length} ref(s)`,
        });
        vscode.postMessage({ type: "nodeClicked", origin });
        return;
      }
      // Diagnostic: dump what we actually see on the node so we can tell
      // whether the renderer never attached origin vs. simple-mind-map
      // dropping the field.
      const n = node as { getData?: (key?: string) => unknown };
      let dataKeys = "<no getData>";
      let textValue = "<unknown>";
      let originType = "<absent>";
      if (typeof n.getData === "function") {
        try {
          const d = n.getData();
          if (d && typeof d === "object") {
            dataKeys = Object.keys(d as object).join(",");
            const t = (d as { text?: unknown }).text;
            if (typeof t === "string") {
              textValue = t.length > 50 ? t.slice(0, 50) + "…" : t;
            }
            const o = (d as { origin?: unknown }).origin;
            originType = `${typeof o}${o === null ? " (null)" : ""}`;
          } else {
            dataKeys = `<${typeof d}>`;
          }
        } catch (err) {
          dataKeys = `<getData threw ${String(err)}>`;
        }
      }
      vscode.postMessage({
        type: "log",
        message:
          `node_click: no origin attached — text="${textValue}" ` +
          `keys=[${dataKeys}] origin=${originType}`,
      });
    });
    vscode.postMessage({ type: "log", message: "node_click listener bound" });
  } catch (err) {
    vscode.postMessage({
      type: "log",
      message: `failed to bind node_click: ${String(err)}`,
    });
  }

  handleResize();
}

function readOrigin(node: unknown): NodeOrigin | undefined {
  if (!node || typeof node !== "object") {
    return undefined;
  }
  const n = node as { getData?: (key?: string) => unknown };
  let data: unknown;
  if (typeof n.getData === "function") {
    try {
      data = n.getData();
    } catch {
      data = undefined;
    }
  }
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const origin = (data as { origin?: unknown }).origin;
  if (!origin || typeof origin !== "object") {
    return undefined;
  }
  const refs = (origin as { refs?: unknown }).refs;
  if (!Array.isArray(refs) || refs.length === 0) {
    return undefined;
  }
  return origin as NodeOrigin;
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
