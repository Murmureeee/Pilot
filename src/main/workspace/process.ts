// @env node
import { execFile, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { TASKKILL_TIMEOUT_MS } from "./constants";

const exec = promisify(execFile);

/** On Unix the caller must spawn the command as a process group leader. */
export async function stopProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;

  if (process.platform === "win32") {
    // An exited Windows process no longer anchors a tree and its PID can be reused.
    if (child.exitCode !== null || child.signalCode !== null) return;
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    await exec(taskkill, ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      timeout: TASKKILL_TIMEOUT_MS,
    });
    return;
  }

  // The group can outlive the shell process that created it.
  try {
    process.kill(-pid, "SIGKILL");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
  }
}
