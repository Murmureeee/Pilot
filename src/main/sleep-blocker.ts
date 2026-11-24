// @env node
import { powerSaveBlocker } from "electron";
import { errorDetails, type DiagnosticLog } from "./diagnostics";

export function createSleepBlocker(log: Pick<DiagnosticLog, "write">): (active: boolean) => void {
  let blockerId: number | undefined;
  return (active): void => {
    try {
      if (active) {
        blockerId ??= powerSaveBlocker.start("prevent-app-suspension");
      } else if (blockerId !== undefined) {
        powerSaveBlocker.stop(blockerId);
        blockerId = undefined;
      }
    } catch (error) {
      log.write(
        "warn",
        "main",
        active ? "sleep-blocker-start-failed" : "sleep-blocker-stop-failed",
        errorDetails(error),
      );
    }
  };
}
