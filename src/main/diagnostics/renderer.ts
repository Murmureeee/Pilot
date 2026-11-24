// @env node
import type { WebContentsConsoleMessageEventParams } from "electron";

import { SAFE_ERROR_NAMES } from "./constants";
import type { DiagnosticLog } from "./index";

export function logRendererConsole(
  log: DiagnosticLog,
  details: Pick<WebContentsConsoleMessageEventParams, "level" | "message" | "lineNumber">,
): void {
  if (details.message === "[app] mounted") {
    log.write("info", "renderer", "mounted");
    return;
  }

  const level =
    details.level === "warning" ? "warn" : details.level === "error" ? "error" : "debug";
  const name = details.message.slice(0, 64).match(/^(?:Uncaught(?: \(in promise\))? )?(\w+):/)?.[1];
  log.write(level, "renderer", "console", {
    errorName: SAFE_ERROR_NAMES.find((value) => value === name),
    line: details.lineNumber > 0 ? details.lineNumber : undefined,
  });
}
