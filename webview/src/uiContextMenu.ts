import type { MindMapUiOptions, MindMapUiPreset } from "./uiTypes";

export type WebviewStrings = {
  menu: {
    sectionTheme: string;
    sectionDirection: string;
    presetAuto: string;
    presetDark: string;
    presetLight: string;
    directionSide: string;
    directionRight: string;
    directionLeft: string;
    download: string;
  };
};

export type UiSettingKey = "preset" | "direction";

export type UiSettingPick = {
  key: UiSettingKey;
  value: string;
};

function presetOptions(
  strings: WebviewStrings
): { value: MindMapUiPreset; label: string }[] {
  return [
    { value: "auto", label: strings.menu.presetAuto },
    { value: "dark", label: strings.menu.presetDark },
    { value: "light", label: strings.menu.presetLight },
  ];
}

function directionOptions(
  strings: WebviewStrings
): { value: string; label: string; dir: 0 | 1 | 2 }[] {
  return [
    { value: "side", label: strings.menu.directionSide, dir: 2 },
    { value: "right", label: strings.menu.directionRight, dir: 1 },
    { value: "left", label: strings.menu.directionLeft, dir: 0 },
  ];
}

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
  const found = [
    { value: "side", dir: 2 },
    { value: "right", dir: 1 },
    { value: "left", dir: 0 },
  ].find((o) => o.dir === direction);
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
  strings: WebviewStrings,
  onPick: (pick: UiSettingPick) => void,
  options?: { onDownload?: () => void; showDownload?: boolean }
): void {
  hideUiContextMenu();
  bindDismissListeners();

  const root = document.createElement("div");
  root.className = "mindmap-ui-menu";
  root.setAttribute("role", "menu");

  const currentDirection = directionToSettingName(currentUi.direction);

  addSection(
    root,
    strings.menu.sectionTheme,
    presetOptions(strings).map((o) => ({
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
    strings.menu.sectionDirection,
    directionOptions(strings).map((o) => ({
      value: o.value,
      label: o.label,
      checked: currentDirection === o.value,
    })),
    (value) => onPick({ key: "direction", value })
  );

  if (options?.showDownload && options.onDownload) {
    const sep2 = document.createElement("div");
    sep2.className = "mindmap-ui-menu__sep";
    root.appendChild(sep2);

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "mindmap-ui-menu__item";
    downloadBtn.setAttribute("role", "menuitem");
    const downloadMark = document.createElement("span");
    downloadMark.className = "mindmap-ui-menu__check";
    downloadMark.textContent = "";
    const downloadLabel = document.createElement("span");
    downloadLabel.className = "mindmap-ui-menu__label";
    downloadLabel.textContent = strings.menu.download;
    downloadBtn.appendChild(downloadMark);
    downloadBtn.appendChild(downloadLabel);
    downloadBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      options.onDownload?.();
      hideUiContextMenu();
    });
    root.appendChild(downloadBtn);
  }

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
