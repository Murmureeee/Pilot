// @env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopProcessTree } from "./windows-process.mjs";

const require = createRequire(import.meta.url);
const startupError = /\bUncaught\b|\bUnhandledPromiseRejection\b|\[renderer\] process gone:/i;

function verifySmoke(profile) {
  const smoke = spawnSync(require("electron"), [".", "--smoke", `--user-data-dir=${profile}`], {
    encoding: "utf8",
    timeout: 45_000,
    windowsHide: true,
  });
  process.stdout.write(smoke.stdout ?? "");
  process.stderr.write(smoke.stderr ?? "");
  if (smoke.error) throw smoke.error;

  const report = smoke.stdout.match(/^SMOKE_RESULT (.+)$/m)?.[1];
  if (smoke.status !== 0 || !report || JSON.parse(report).ok !== true) {
    throw new Error(`Electron smoke test failed (exit code ${smoke.status})`);
  }
}

async function verifyDevelopmentStartup(profile) {
  const electronVite = join(
    dirname(require.resolve("electron-vite/package.json")),
    "bin",
    "electron-vite.js",
  );
  const dev = spawn(process.execPath, [electronVite, "dev", "--", `--user-data-dir=${profile}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let launchError;
  dev.stdout.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  dev.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  dev.on("error", (error) => {
    launchError = error;
  });

  try {
    const deadline = performance.now() + 55_000;
    let mountedAt;
    while (performance.now() < deadline) {
      if (launchError) throw launchError;
      if (startupError.test(stdout) || startupError.test(stderr)) {
        throw new Error("Electron reported an uncaught startup error");
      }
      if (dev.exitCode !== null || dev.signalCode !== null) {
        throw new Error(
          `Development app exited before verification (${dev.exitCode ?? dev.signalCode})`,
        );
      }
      if (stdout.includes("[renderer] [app] mounted")) {
        // React can report a render error after the entry point logs the mount marker.
        mountedAt ??= performance.now();
        if (performance.now() - mountedAt >= 1_000) return;
      }
      await delay(200);
    }
    throw new Error("Timed out waiting for the development renderer to mount");
  } finally {
    // electron-vite owns both the dev server and the Electron process tree.
    stopProcessTree(dev);
  }
}

if (process.platform !== "win32") throw new Error("The Electron check requires Windows");

const profiles = mkdtempSync(join(tmpdir(), "pilot-ci-"));
try {
  verifySmoke(join(profiles, "smoke"));
  await verifyDevelopmentStartup(join(profiles, "dev"));
} finally {
  rmSync(profiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
