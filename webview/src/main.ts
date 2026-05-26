import MindMap from "simple-mind-map";
import "simple-mind-map/dist/simpleMindMap.esm.css";
import "./styles.css";

type MindMapNodeData = {
  data: { text: string; expand?: boolean };
  children?: MindMapNodeData[];
};

type ExtensionMessage = {
  type: "setData";
  data: MindMapNodeData;
};

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
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
