// @env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

import { stopProcessTree } from "../windows-process.mjs";

const require = createRequire(import.meta.url);
export const repository = fileURLToPath(new URL("../../", import.meta.url));
const startupError = /\bUncaught\b|\bUnhandledPromiseRejection\b|\[renderer\] process gone:/i;
const timeout = 15_000;

export async function withDesktop(profile, verify, project, executable) {
  const env = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  const startedAt = performance.timeOrigin + performance.now();
  const app = await electron.launch({
    executablePath: executable ?? require("electron"),
    args: [
      ...(executable ? [] : ["."]),
      "--user-data-dir=" + profile,
      "--remote-debugging-address=127.0.0.1",
      "--disable-backgrounding-occluded-windows",
      ...(project ? [project] : []),
    ],
    cwd: executable ? dirname(executable) : repository,
    env,
    timeout: 45_000,
  });
  const child = app.process();
  const logs = [];
  const errors = [];
  const capture = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 50) logs.shift();
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  let page;
  try {
    page = await app.firstWindow();
    page.setDefaultTimeout(timeout);
    page.on("pageerror", (error) => errors.push(error.message));
    const window = await app.browserWindow(page);
    // Scene assertions also run when the test window is occluded on the runner.
    await window.evaluate((win) => {
      win.webContents.setBackgroundThrottling(false);
      win.focus();
    });
    await page.bringToFront();
    const info = await page.evaluate(() => window.pi.getAppInfo());
    assert.equal(realpathSync.native(info.settingsDir), profile);
    await verify(page, window, app, startedAt);

    let code = child.exitCode;
    if (code === null) {
      // Let the debugger receive the IPC response before the app closes its window.
      const [[exitCode]] = await Promise.all([
        once(child, "exit", { signal: AbortSignal.timeout(timeout) }),
        page.evaluate(() => setTimeout(() => void window.pi.menuAction("quit"), 50)),
      ]);
      code = exitCode;
    }
    assert.equal(code, 0, "The UI test app must quit cleanly");
    assert.deepEqual(errors, [], "The renderer reported an uncaught exception");
    assert.doesNotMatch(logs.join(""), startupError);
  } catch (error) {
    if (logs.length) console.error(logs.join("").trim());
    if (errors.length) console.error("Renderer exceptions", errors);
    if (page && !page.isClosed()) {
      const contents = await page
        .locator("body")
        .innerText({ timeout: 2_000 })
        .catch(() => "");
      if (contents) console.error(contents.slice(0, 3_000));
    }
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit", { signal: AbortSignal.timeout(timeout) });
      stopProcessTree(child);
      await exited;
    }
  }
}
