import type { MindMapUiOptions, MindMapUiPreset } from "./uiTypes";

export type UiSettingKey = "preset" | "direction";

export type UiSettingPick = {
  key: UiSettingKey;
  value: string;
};

const PRESET_OPTIONS: { value: MindMapUiPreset; label: string }[] = [
  { value: "auto", label: "跟随编辑器" },
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
];

const DIRECTION_OPTIONS: { value: string; label: string; dir: 0 | 1 | 2 }[] = [
  { value: "side", label: "两侧（先右后左）", dir: 2 },
  { value: "right", label: "向右", dir: 1 },
  { value: "left", label: "向左", dir: 0 },
];

let menuEl: HTMLDivElement | undefined;
let dismissListenersBound = false;

export function isBlankCanvasTarget(
  target: EventTarget | null,
  container: HTMLElement
): boolean {
  if (!(target instanceof Node)) {
    return false;
  }
  if (!container.contains(target)) {
    return false;
  }
  const el = target instanceof Element ? target : target.parentElement;
  if (!el) {
    return false;
  }
  if (el.closest("me-tpc")) {
    return false;
  }
  if (el.closest(".mindmap-ui-menu")) {
    return false;
  }
  return true;
}

function directionToSettingName(direction: 0 | 1 | 2): string {
  const found = DIRECTION_OPTIONS.find((o) => o.dir === direction);
  return found?.value ?? "side";
}

function bindDismissListeners(): void {
  if (dismissListenersBound) {
    return;
  }
  dismissListenersBound = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menuEl) {
        return;
      }
      if (e.target instanceof Node && menuEl.contains(e.target)) {
        return;
      }
      hideUiContextMenu();
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideUiContextMenu();
    }
  });
}

export function hideUiContextMenu(): void {
  menuEl?.remove();
  menuEl = undefined;
}

function addSection(
  parent: HTMLElement,
  title: string,
  options: { value: string; label: string; checked: boolean }[],
  onPick: (value: string) => void
): void {
  const heading = document.createElement("div");
  heading.className = "mindmap-ui-menu__heading";
  heading.textContent = title;
  parent.appendChild(heading);

  for (const opt of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "mindmap-ui-menu__item";
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", opt.checked ? "true" : "false");
    const mark = document.createElement("span");
    mark.className = "mindmap-ui-menu__check";
    mark.textContent = opt.checked ? "✓" : "";
    const label = document.createElement("span");
    label.className = "mindmap-ui-menu__label";
    label.textContent = opt.label;
    item.appendChild(mark);
    item.appendChild(label);
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(opt.value);
      hideUiContextMenu();
    });
    parent.appendChild(item);
  }
}

export function showUiContextMenu(
  clientX: number,
  clientY: number,
  currentUi: MindMapUiOptions,
  onPick: (pick: UiSettingPick) => void
): void {
  hideUiContextMenu();
  bindDismissListeners();

  const root = document.createElement("div");
  root.className = "mindmap-ui-menu";
  root.setAttribute("role", "menu");

  const currentDirection = directionToSettingName(currentUi.direction);

  addSection(
    root,
    "主题",
    PRESET_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      checked: currentUi.preset === o.value,
    })),
    (value) => onPick({ key: "preset", value })
  );

  const sep = document.createElement("div");
  sep.className = "mindmap-ui-menu__sep";
  root.appendChild(sep);

  addSection(
    root,
    "布局方向",
    DIRECTION_OPTIONS.map((o) => ({
      value: o.value,
      label: o.label,
      checked: currentDirection === o.value,
    })),
    (value) => onPick({ key: "direction", value })
  );

  document.body.appendChild(root);
  menuEl = root;

  const pad = 4;
  const rect = root.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - pad) {
    left = window.innerWidth - rect.width - pad;
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = window.innerHeight - rect.height - pad;
  }
  root.style.left = `${Math.max(pad, left)}px`;
  root.style.top = `${Math.max(pad, top)}px`;
}
