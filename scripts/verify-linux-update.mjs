// @env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { chromium } from "playwright-core";

const baselineVersion = "0.0.1";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const appImageName = (value) => "pilot-" + value + "-linux-x86_64.AppImage";
const debName = (value) => "pilot-" + value + "-linux-amd64.deb";
const manifest = "latest-linux.yml";
const release = resolve("dist");
const scratch = await mkdtemp(join(tmpdir(), "pilot-linux-update-"));
const baseline = join(scratch, "baseline");
let feedDirectory = baseline;
const children = [];

async function hash(path) {
  const digest = createHash("sha512");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("base64");
}

async function serveUpdate(request, response) {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const name = basename(path);
  if (![manifest, appImageName(version), debName(version)].includes(name)) {
    response.writeHead(404).end();
    return;
  }
  // Answer whole-file requests so this suite exercises checksum validation on both formats.
  if (request.headers.range) {
    response.writeHead(416).end();
    return;
  }
  const file = join(feedDirectory, name);
  const { size } = await stat(file);
  response.writeHead(200, { "content-length": size });
  const input = createReadStream(file);
  input.on("error", (error) => response.destroy(error));
  response.on("close", () => input.destroy());
  input.pipe(response);
}

const feed = createServer((request, response) => {
  void serveUpdate(request, response).catch((error) => response.destroy(error));
});

async function waitFor(label, check, timeout = 25_000) {
  const end = performance.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(120);
  } while (performance.now() < end);
  throw new Error("Timed out waiting for " + label);
}

function status(page) {
  return page.evaluate(() => window.pi.getUpdateStatus());
}

async function expectState(page, expected) {
  return waitFor(expected, async () => {
    const state = await status(page);
    if (state.state === "error" && expected !== "error") {
      throw new Error("Unexpected update error: " + JSON.stringify(state));
    }
    return state.state === expected && state;
  });
}

async function connect(profile) {
  const portFile = join(profile, "DevToolsActivePort");
  return waitFor("the desktop window", async () => {
    const port = (await readFile(portFile, "utf8").catch(() => "")).split("\n")[0];
    if (!port) return;
    const browser = await chromium
      .connectOverCDP("http://127.0.0.1:" + port, { timeout: 1_000 })
      .catch(() => undefined);
    if (!browser) return;
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      page.setDefaultTimeout(10_000);
      return { browser, page };
    }
    await browser.close();
  });
}

async function launch(executable, profile, cache) {
  const child = spawn(
    executable,
    [
      "--no-sandbox",
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--user-data-dir=" + profile,
    ],
    {
      detached: true,
      stdio: "inherit",
      env: {
        ...process.env,
        APPIMAGE_EXTRACT_AND_RUN: "1",
        TMPDIR: scratch,
        XDG_CACHE_HOME: cache,
        XDG_CONFIG_HOME: join(scratch, "config"),
      },
    },
  );
  children.push(child);
  await once(child, "spawn");
  const app = await connect(profile);
  await app.page.waitForFunction(() => Boolean(window.pi));
  return app;
}

function closeApp(page) {
  return page.evaluate(() => {
    setTimeout(() => void window.pi.menuAction("quit"), 100);
  });
}

async function openUpdate(page) {
  await page.getByRole("button", { name: "应用菜单", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "检查更新…", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: "软件更新", exact: true });
  await dialog.waitFor();
  return dialog;
}

function downloadPath(cache, name) {
  return join(cache, "pilot-updater", "pending", name);
}

async function verifyAppImage() {
  const old = join(baseline, appImageName(baselineVersion));
  const name = appImageName(version);
  const profile = join(scratch, "appimage-profile");
  const cache = join(scratch, "appimage-cache");
  const { browser, page } = await launch(old, profile, cache);
  const original = await hash(old);
  const draft = "Draft saved before the AppImage update.";
  try {
    await expectState(page, "current");
    const editor = page.locator("[data-composer-editor]");
    await editor.fill(draft);
    const saved = await waitFor("the saved draft", async () => {
      const snapshot = await page.evaluate(() => window.pi.getSnapshot());
      return snapshot.composerDraft?.includes(draft) && snapshot;
    });
    feedDirectory = release;
    const dialog = await openUpdate(page);
    const install = dialog.getByRole("button", { name: "更新并重启", exact: true });
    assert.equal((await expectState(page, "ready")).version, version);
    const downloaded = downloadPath(cache, name);
    assert.equal(await hash(downloaded), await hash(join(release, name)));
    await unlink(downloaded);
    await install.click();
    await expectState(page, "error");
    await dialog.getByText("AppImage 更新失败。请确认所在目录可写，再重试。").waitFor();
    assert.equal(await hash(old), original, "A failed update must keep the current AppImage");
    await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
    await expectState(page, "ready");
    await install.click();
    await waitFor("the original image to exit", () => !browser.isConnected());
    const restarted = await connect(profile);
    try {
      assert.equal((await restarted.page.evaluate(() => window.pi.getAppInfo())).version, version);
      const restored = await restarted.page.evaluate(
        (id) => (id ? window.pi.sessionLoad(id) : window.pi.getSnapshot()),
        saved.sessionId,
      );
      assert.ok(restored.composerDraft.includes(draft));
      assert.equal(await hash(old), await hash(join(release, name)));
      await closeApp(restarted.page);
      await waitFor("the restarted AppImage to exit", () => !restarted.browser.isConnected());
    } finally {
      await restarted.browser.close();
    }
    console.log(
      "AppImage updated in place, reopened with the draft, and survived a failed replacement",
    );
  } finally {
    await browser.close();
  }
}

async function verifyDeb() {
  feedDirectory = baseline;
  const unpacked = join(scratch, "deb");
  execFileSync("bash", [
    "-c",
    'exec dpkg-deb -x "$1" "$2"',
    "unpack-test-package",
    join(baseline, debName(baselineVersion)),
    unpacked,
  ]);
  assert.equal(
    (await readFile(join(unpacked, "opt/Pilot/resources/package-type"), "utf8")).trim(),
    "deb",
  );
  const profile = join(scratch, "deb-profile");
  const cache = join(scratch, "deb-cache");
  const { browser, page } = await launch(join(unpacked, "opt/Pilot/pilot"), profile, cache);
  try {
    await expectState(page, "current");
    feedDirectory = release;
    const dialog = await openUpdate(page);
    assert.equal((await expectState(page, "package-ready")).version, version);
    const received = downloadPath(cache, debName(version));
    assert.equal(await hash(received), await hash(join(release, debName(version))));
    await dialog.getByText(/请用系统包管理器安装/).waitFor();
    await dialog.getByRole("button", { name: "打开下载位置", exact: true }).press("Enter");
    await expectState(page, "package-ready");
    await closeApp(page);
    await waitFor("the Debian application to exit", () => !browser.isConnected());
    console.log(
      "Debian update checked, downloaded the verified .deb, and showed the package manager handoff",
    );
  } finally {
    await browser.close();
  }
}

async function closeFixture() {
  feed.closeAllConnections();
  await new Promise((closed) => feed.close(closed));
  for (const child of children) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    if (child.exitCode === null && child.signalCode === null && child.pid)
      await once(child, "exit");
  }
  await rm(scratch, { recursive: true, force: true });
}

try {
  feed.listen(0, "127.0.0.1");
  await once(feed, "listening");
  execFileSync(
    process.execPath,
    [
      "scripts/package-linux.mjs",
      "-c.directories.output=" + baseline,
      "-c.extraMetadata.version=" + baselineVersion,
      "-c.deb.compression=gz",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, PILOT_UPDATE_URL: "http://127.0.0.1:" + feed.address().port + "/" },
    },
  );
  const publicManifest = await readFile(join(release, manifest), "utf8");
  for (const name of [appImageName(version), debName(version)]) {
    assert.ok(publicManifest.includes("- url: " + name), "Missing Linux update asset " + name);
  }
  await verifyAppImage();
  await verifyDeb();
} finally {
  await closeFixture();
}
