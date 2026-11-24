// @env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
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

async function verifySingleInstance(profile, inspectorUrl) {
  assert.ok(inspectorUrl, "The development app must expose its local inspector");
  const alias = join(dirname(profile), "dev-alias");
  symlinkSync(profile, alias, "junction");
  const socket = new WebSocket(inspectorUrl);
  let duplicate;
  try {
    await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
    let requestId = 0;
    async function evaluate(expression) {
      const id = ++requestId;
      const response = once(socket, "message", { signal: AbortSignal.timeout(5_000) });
      socket.send(
        JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
      );
      const [{ data }] = await response;
      const reply = JSON.parse(data);
      assert.equal(reply.id, id);
      assert.ok(!reply.error, reply.error?.message);
      const details = reply.result.exceptionDetails;
      assert.ok(!details, details?.exception?.description ?? details?.text);
      return reply.result.result.value;
    }

    const windows = 'process.mainModule.require("electron").BrowserWindow.getAllWindows()';
    const windowState = `${windows}.map((win) => ({ id: win.id, minimized: win.isMinimized() }))`;
    const [window] = await evaluate(windowState);
    await evaluate(`${windows}[0].minimize()`);
    assert.deepEqual(await evaluate(windowState), [{ id: window.id, minimized: true }]);

    duplicate = spawn(require("electron"), [".", `--user-data-dir=${alias}`], {
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    });
    let stdout = "";
    duplicate.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    const [exitCode] = await once(duplicate, "close", { signal: AbortSignal.timeout(15_000) });
    assert.equal(exitCode, 0, "The duplicate instance must exit successfully");
    assert.ok(!stdout.includes("[renderer] [app] mounted"), "The duplicate must not load a renderer");

    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline) {
      const state = await evaluate(windowState);
      if (state.length === 1 && state[0].id === window.id && !state[0].minimized) {
        console.log("Single instance restored the original window through a profile junction");
        return;
      }
      await delay(100);
    }
    throw new Error("The duplicate launch did not restore the original window");
  } finally {
    socket.close();
    if (duplicate) stopProcessTree(duplicate);
  }
}

async function verifyDevelopmentStartup(profile) {
  const electronVite = join(
    dirname(require.resolve("electron-vite/package.json")),
    "bin",
    "electron-vite.js",
  );
  const dev = spawn(
    process.execPath,
    [electronVite, "dev", "--", `--user-data-dir=${profile}`, "--inspect=0"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
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
        if (performance.now() - mountedAt >= 1_000) {
          const inspectorUrl = stderr.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[\w-]+)/)?.[1];
          await verifySingleInstance(profile, inspectorUrl);
          if (startupError.test(stdout) || startupError.test(stderr)) {
            throw new Error("Electron reported an uncaught error while restoring its window");
          }
          return;
        }
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
