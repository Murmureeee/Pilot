// @env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { screen, type BrowserWindow, type Rectangle } from "electron";
import { z } from "zod";
import {
  MINIMUM_VISIBLE_TITLE_BAR,
  MINIMUM_WINDOW_SIZE,
  WINDOW_STATE_SAVE_DELAY_MS,
  WINDOW_TITLE_BAR_HEIGHT,
} from "./constants";
import { errorDetails, type DiagnosticLog } from "./diagnostics";
import type { WindowState } from "./types";

const rectangle = z.object({
  x: z.int32(),
  y: z.int32(),
  width: z.int32().positive(),
  height: z.int32().positive(),
});
const savedState = z.object({ bounds: rectangle, maximized: z.boolean() });

function areaWithVisibleTitleBar(bounds: Rectangle): Rectangle | undefined {
  let bestArea: Rectangle | undefined;
  let bestOverlap = 0;
  for (const { workArea } of screen.getAllDisplays()) {
    const right = Math.min(workArea.x + workArea.width, bounds.x + bounds.width);
    const bottom = Math.min(workArea.y + workArea.height, bounds.y + bounds.height);
    const top = Math.max(workArea.y, bounds.y);
    const width = right - Math.max(workArea.x, bounds.x);
    const titleHeight = Math.min(bottom, bounds.y + WINDOW_TITLE_BAR_HEIGHT) - top;
    if (
      width < Math.min(MINIMUM_VISIBLE_TITLE_BAR.width, workArea.width) ||
      titleHeight < Math.min(MINIMUM_VISIBLE_TITLE_BAR.height, workArea.height)
    )
      continue;

    const overlap = width * (bottom - top);
    if (overlap > bestOverlap) {
      bestArea = workArea;
      bestOverlap = overlap;
    }
  }
  return bestArea;
}

function visibleBounds(bounds: Rectangle): Rectangle {
  const area = areaWithVisibleTitleBar(bounds);
  const target = area ?? screen.getPrimaryDisplay().workArea;
  const width = Math.max(MINIMUM_WINDOW_SIZE.width, Math.min(bounds.width, target.width));
  const height = Math.max(MINIMUM_WINDOW_SIZE.height, Math.min(bounds.height, target.height));
  const remainingWidth = Math.max(0, target.width - width);
  const remainingHeight = Math.max(0, target.height - height);

  if (!area) {
    return {
      x: target.x + Math.floor(remainingWidth / 2),
      y: target.y + Math.floor(remainingHeight / 2),
      width,
      height,
    };
  }

  return {
    x: Math.max(target.x, Math.min(bounds.x, target.x + remainingWidth)),
    y: Math.max(target.y, Math.min(bounds.y, target.y + remainingHeight)),
    width,
    height,
  };
}

export function loadWindowState(file: string): WindowState | undefined {
  let state: WindowState;
  try {
    state = savedState.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return undefined;
  }
  return { bounds: visibleBounds(state.bounds), maximized: state.maximized };
}

export function rememberWindow(
  win: BrowserWindow,
  file: string,
  log: Pick<DiagnosticLog, "write">,
): void {
  let maximized = win.isMaximized();
  let pending: ReturnType<typeof setTimeout> | undefined;
  let lastSaved: string | undefined;

  function save(): void {
    clearTimeout(pending);
    pending = undefined;
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    if (!rectangle.safeParse(bounds).success) return;
    const json = JSON.stringify({ bounds, maximized } satisfies WindowState);
    if (json === lastSaved) return;
    try {
      const temporary = `${file}.tmp`;
      writeFileSync(temporary, json, { encoding: "utf8", flush: true });
      renameSync(temporary, file);
      lastSaved = json;
    } catch (error) {
      log.write("warn", "main", "window-state-save-failed", errorDetails(error));
    }
  }

  function queueSave(): void {
    clearTimeout(pending);
    pending = setTimeout(save, WINDOW_STATE_SAVE_DELAY_MS);
    pending.unref();
  }

  function keepWindowVisible(): void {
    if (win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
    const current = win.getBounds();
    const next = visibleBounds(current);
    if (
      next.x !== current.x ||
      next.y !== current.y ||
      next.width !== current.width ||
      next.height !== current.height
    ) {
      win.setBounds(next);
    }
  }

  win.on("move", queueSave);
  win.on("resize", queueSave);
  win.on("maximize", () => {
    maximized = true;
    queueSave();
  });
  win.on("unmaximize", () => {
    if (!win.isMinimized() && !win.isFullScreen()) maximized = false;
    keepWindowVisible();
    queueSave();
  });
  win.on("restore", keepWindowVisible);
  win.on("leave-full-screen", keepWindowVisible);
  win.on("close", save);
  screen.on("display-removed", keepWindowVisible);
  screen.on("display-metrics-changed", keepWindowVisible);
  win.once("closed", () => {
    clearTimeout(pending);
    screen.off("display-removed", keepWindowVisible);
    screen.off("display-metrics-changed", keepWindowVisible);
  });
}
