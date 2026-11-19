// @env node
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function stopProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;

  const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
  const stopped = spawnSync(taskkill, ["/pid", String(child.pid), "/t", "/f"], {
    stdio: "inherit",
    timeout: 10_000,
    windowsHide: true,
  });
  if (stopped.status !== 0) {
    child.kill();
    throw stopped.error ?? new Error("Could not stop the test process tree");
  }
}
