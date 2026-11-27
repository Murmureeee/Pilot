// @env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { _electron as electron } from "playwright-core";

import { expectUpdateState, hash, openUpdate, verifyProjectShell, waitFor } from "./verify-posix-desktop.mjs";

assert.equal(process.platform, "darwin");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const signed = process.env.PILOT_MAC_SIGNED === "true";
const arch = process.arch;
const release = resolve("dist");
const asset = "pilot-" + version + "-mac-" + arch;
const manifest = "latest-mac.yml";
const zip = asset + ".zip";
const oldVersion = "0.0.1";
const fixtureKey = "pilot-mac-keychain-fixture";
const fixtureName = "pilot-mac-update-fixture-" + process.pid;
const updateCache = join(homedir(), "Library", "Caches", fixtureName + "-updater");
const scratch = await realpath(await mkdtemp(join(tmpdir(), "pilot-macos-")));
const project = join(scratch, "Pilot 项目");
const baseline = join(scratch, "baseline");
const mounted = join(scratch, "volume");
const installed = join(scratch, "Applications", "Pilot.app");
function executable(bundle) {
  const executableName = execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleExecutable",
    join(bundle, "Contents", "Info.plist"),
  ], { encoding: "utf8" }).trim();
  return join(bundle, "Contents", "MacOS", executableName);
}
let latest = false;
let authorizedRequests = 0;

function run(program, args, options) {
  return execFileSync(program, args, { stdio: "inherit", ...options });
}

async function withApp(bundle, profile, verify, directory) {
  const env = { ...process.env };
  for (const name of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
    delete env[name];
  }
  const app = await electron.launch({
    executablePath: executable(bundle),
    args: ["--user-data-dir=" + profile, ...(directory ? ["--open-project=" + directory] : [])],
    env,
    timeout: 35_000,
  });
  const child = app.process();
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.waitForFunction(() => Boolean(window.pi));
    const info = await page.evaluate(() => window.pi.getAppInfo());
    assert.equal(info.isDev, false);
    assert.equal(await realpath(info.settingsDir), await realpath(profile));
    await verify(page, app, info);
    const exited = once(child, "exit", { signal: AbortSignal.timeout(20_000) });
    await page.evaluate(() => { setTimeout(() => void window.pi.menuAction("quit"), 100); });
    assert.equal((await exited)[0], 0);
    assert.deepEqual(errors, []);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit", { signal: AbortSignal.timeout(15_000) });
      child.kill("SIGKILL");
      await exited;
    }
  }
}

function installFromDmg() {
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mounted, join(release, asset + ".dmg")]);
  try {
    run("ditto", [join(mounted, "Pilot.app"), installed]);
  } finally {
    run("hdiutil", ["detach", mounted]);
  }
}

async function verifyWindow(page, app) {
  const window = await app.browserWindow(page);
  assert.ok(await window.evaluate((win) => win.getWindowButtonPosition()));
  const menu = page.getByRole("button", { name: "应用菜单", exact: true });
  for (const [width, height] of [[1100, 750], [720, 480]]) {
    await window.evaluate((win, [width, height]) => win.setContentSize(width, height), [width, height]);
    await page.waitForFunction((width) => Math.abs(innerWidth - width) <= 1, width);
    await menu.evaluate((button) => {
      const overlay = navigator.windowControlsOverlay;
      if (!overlay.visible || overlay.getTitlebarAreaRect().x <= 0) {
        throw new Error("macOS traffic lights have no reserved title bar area");
      }
      if (button.getBoundingClientRect().left < overlay.getTitlebarAreaRect().x) {
        throw new Error("The application menu overlaps the traffic lights");
      }
    });
    await menu.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "检查更新…", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "检查更新…", exact: true }).waitFor({ state: "hidden" });
    assert.ok(await menu.evaluate((button) => document.activeElement === button));
  }
}

async function verifyNativePicker(page, app, directory) {
  const pid = String(app.process().pid);
  const probe = spawnSync("osascript", [
    "-e", 'on run argv',
    "-e", 'tell application "System Events" to get name of windows of (first application process whose unix id is ((item 1 of argv) as integer))',
    "-e", "end run", pid,
  ], { encoding: "utf8", timeout: 10_000 });
  if (probe.status !== 0) {
    const message = probe.error?.code ?? probe.stderr.trim();
    if (!/ETIMEDOUT|not authorized|assistive access|not allowed|-1743|-1719/i.test(message)) {
      throw new Error("The macOS directory picker could not be inspected: " + message);
    }
    console.log("macOS native directory selection requires Accessibility access: " + message);
    return;
  }

  await page.evaluate(() => {
    void window.pi.pickWorkingDirectory("en").then((path) => {
      globalThis.pilotPickedDirectory = { path };
    });
  });
  const choose = [
    "on run argv",
    "  set pilotPid to (item 1 of argv) as integer",
    "  set folderPath to item 2 of argv",
    '  tell application "System Events"',
    "    set pilotProcess to first application process whose unix id is pilotPid",
    "    set frontmost of pilotProcess to true",
    "    repeat 60 times",
    '      if exists window "Choose the tools’ working directory" of pilotProcess then exit repeat',
    "      delay 0.1",
    "    end repeat",
    '    if not (exists window "Choose the tools’ working directory" of pilotProcess) then error "Directory picker did not appear"',
    '    keystroke "g" using {command down, shift down}',
    "    delay 0.3",
    "    keystroke folderPath",
    "    delay 0.6",
    "    key code 36",
    "    delay 0.5",
    "    key code 36",
    "  end tell",
    "end run",
  ].join("\n");
  run("osascript", ["-e", choose, pid, directory], { timeout: 15_000 });
  const chosen = await waitFor("the macOS directory selection", () =>
    page.evaluate(() => globalThis.pilotPickedDirectory),
  );
  assert.ok(chosen.path, "The macOS directory picker was canceled");
  assert.equal(await realpath(chosen.path), await realpath(directory));
  console.log("Verified the macOS native directory picker selected an existing folder");
}

const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://127.0.0.1").pathname;
    if (request.method === "POST" && path === "/v1/chat/completions") {
      if (request.headers.authorization !== "Bearer " + fixtureKey) {
        response.writeHead(401).end();
        return;
      }
      request.resume();
      authorizedRequests++;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture" };
      response.end("data: " + JSON.stringify({
        ...chunk,
        choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      }) + "\n\ndata: [DONE]\n\n");
      return;
    }
    const file = path === "/" + manifest
      ? join(latest ? release : baseline, manifest)
      : latest && path === "/" + zip ? join(release, zip) : null;
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": (await stat(file)).size });
    const stream = createReadStream(file);
    stream.on("error", (error) => response.destroy(error));
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    response.destroy(error);
  }
});

try {
  await mkdir(project);
  await writeFile(join(project, "marker.txt"), "Pilot project fixture\n");
  await mkdir(join(scratch, "Applications"));
  await mkdir(mounted);
  const manifestText = await readFile(join(release, manifest), "utf8");
  assert.ok(manifestText.includes("version: " + version + "\n"));
  assert.ok(manifestText.includes("- url: " + zip + "\n    sha512: " + await hash(join(release, zip))));
  installFromDmg();
  run("codesign", ["--verify", "--deep", "--strict", installed]);
  if (signed) {
    run("xcrun", ["stapler", "validate", installed]);
    run("spctl", ["--assess", "--type", "execute", "--verbose=2", installed]);
  }

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const profile = join(scratch, "dmg-profile");
  await withApp(installed, profile, async (page, app, info) => {
    assert.equal(info.version, version);
    await verifyWindow(page, app);
    await verifyProjectShell(page, project);
    const selected = join(scratch, "selected");
    await mkdir(selected);
    await verifyNativePicker(page, app, selected);
    const settings = await page.evaluate(([baseUrl, apiKey]) => window.pi.settingsSave({
      providers: [{ id: "fixture", name: "Fixture", kind: "openai-compatible", baseUrl, apiKey, modelId: "fixture" }],
      activeProviderId: "fixture",
    }), [origin + "/v1", fixtureKey]);
    assert.equal(settings.providers[0].hasKey, true);
    assert.equal(settings.providers[0].apiKey, undefined);
  }, project);
  const settings = JSON.parse(await readFile(join(profile, "settings.json"), "utf8"));
  assert.ok(settings.providers[0].apiKey);
  assert.notEqual(settings.providers[0].apiKey, fixtureKey);
  await rm(installed, { recursive: true, force: true });
  installFromDmg();
  await withApp(installed, profile, async (page) => {
    const tested = await page.evaluate(() => window.pi.testProvider("fixture"));
    assert.equal(tested.ok, true, JSON.stringify(tested));
    assert.equal(authorizedRequests, 1);
  });
  console.log("Verified DMG install, macOS window controls, Bash, and the Keychain credential after reinstall");

  run(process.execPath, [
    "scripts/package-mac.mjs",
    "-c.directories.output=" + baseline,
    "-c.extraMetadata.version=" + oldVersion,
    "-c.extraMetadata.name=" + fixtureName,
    "-c.mac.target=zip",
    ...(signed ? ["-c.mac.notarize=false"] : []),
  ], { env: { ...process.env, PILOT_UPDATE_URL: origin + "/" } });
  const oldBundle = join(baseline, arch === "arm64" ? "mac-arm64" : "mac", "Pilot.app");
  await withApp(oldBundle, join(scratch, "update-profile"), async (page, _app, info) => {
    assert.equal(info.version, oldVersion);
    await expectUpdateState(page, "current");
    await page.evaluate(() => window.pi.settingsSetAutoDownloadUpdates(false));
    latest = true;
    const dialog = await openUpdate(page);
    assert.equal((await expectUpdateState(page, "available")).version, version);
    await dialog.getByRole("button", { name: "下载更新", exact: true }).press("Enter");
    assert.equal((await expectUpdateState(page, "ready")).version, version);
    assert.equal(await hash(join(updateCache, "pending", zip)), await hash(join(release, zip)));
    await dialog.getByRole("button", { name: "更新并重启", exact: true }).waitFor();
  });
  console.log("Verified macOS update discovery and manual download of the matching ZIP");
} finally {
  if (server.listening) {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
  await rm(updateCache, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
}
