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

function render(data: MindMapNodeData): void {
  if (mindMap) {
    mindMap.setData(data);
    handleResize();
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
