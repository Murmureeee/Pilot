// @env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { on, once } from "node:events";
import {
  existsSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { createServer as createHttpsServer } from "node:https";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopProcessTree } from "./windows-process.mjs";

const exeName = "pi Desktop.exe";
const legacyName = "pi Desktop";
const legacyVersion = "0.1.0";
const skillId = "installer-acceptance";
const skillBody =
  "---\nname: Installer acceptance\ndescription: A test skill\n---\nVerify that this file survives an upgrade.\n";
const sessionTitle = "Legacy installer acceptance";
const persona = "Installer acceptance preference";

async function waitFor(label, check, timeout = 25_000) {
  const deadline = performance.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await delay(150);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

function runInstaller(file, directory, args = ["/S"]) {
  const run = spawnSync(file, args, {
    cwd: directory,
    timeout: 120_000,
    windowsHide: true,
    argv0: `"${file}"`,
    windowsVerbatimArguments: true,
    stdio: "inherit",
  });
  if (run.error) throw run.error;
  assert.equal(run.status, 0, `${basename(file)} failed`);
}

async function uninstall(directory) {
  if (!existsSync(join(directory, exeName))) return;
  const uninstaller = ["Pilot", legacyName]
    .map((name) => join(directory, `Uninstall ${name}.exe`))
    .find(existsSync);
  assert.ok(uninstaller, "The installation must create an uninstaller");
  runInstaller(uninstaller, directory);
  await waitFor("uninstallation", () => !existsSync(join(directory, exeName)));
}

async function freeLoopbackPort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((release) => server.close(release));
  return port;
}

async function findPage(port, child) {
  return waitFor("the installed renderer", async () => {
    assert.equal(child.exitCode, null, "The installed app exited during startup");
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    }).catch(() => null);
    if (!response?.ok) return;
    const pages = await response.json();
    const page = pages.find(({ type, url }) => type === "page" && url.startsWith("file:"));
    if (!page) return;
    const url = new URL(page.webSocketDebuggerUrl);
    assert.equal(url.origin, `ws://127.0.0.1:${port}`);
    return url;
  });
}

async function withApp(directory, profile, verify, installsUpdate = false) {
  const port = await freeLoopbackPort();
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profile}`,
  ];
  if (certificatePin) {
    // The loopback fixture uses a temporary certificate.
    args.push(`--ignore-certificate-errors-spki-list=${certificatePin}`);
  }
  const child = spawn(join(directory, exeName), args, {
    cwd: directory,
    env: { ...process.env, LOCALAPPDATA: updateCache },
    windowsHide: true,
    stdio: "inherit",
  });
  const exited = once(child, "exit");
  // A failed spawn must be handled even while the test is waiting for the debugger to open.
  exited.catch(() => undefined);
  let socket;
  try {
    socket = new WebSocket(
      await Promise.race([
        findPage(port, child),
        exited.then(() => {
          throw new Error("The installed app exited before the renderer was available");
        }),
      ]),
    );
    await once(socket, "open", { signal: AbortSignal.timeout(5_000) });
    let nextRequest = 0;
    async function evaluate(fn, ...values) {
      const id = ++nextRequest;
      const messages = on(socket, "message", {
        signal: AbortSignal.timeout(10_000),
        close: ["close"],
      });
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression: `(${fn.toString()})(...${JSON.stringify(values)})`,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
      for await (const [event] of messages) {
        const reply = JSON.parse(event.data);
        if (reply.id !== id) continue;
        assert.ok(!reply.error, reply.error?.message);
        const details = reply.result.exceptionDetails;
        assert.ok(!details, details?.exception?.description ?? details?.text);
        return reply.result.result.value;
      }
      throw new Error("The installed renderer disconnected");
    }
    await waitFor("the application API", () => evaluate(() => Boolean(window.pi)));
    const result = await verify(evaluate);
    if (!installsUpdate) {
      await evaluate(() => {
        // Let the debugger receive the response before the quit action closes the window.
        setTimeout(() => void window.pi.menuAction("quit"), 100);
      });
    }
    await waitFor("the app to quit", () => child.exitCode !== null);
    assert.equal(child.exitCode, 0, "The installed app must quit successfully");
    return result;
  } finally {
    socket?.close();
    stopProcessTree(child);
  }
}

async function click(evaluate, label) {
  await waitFor(label, () =>
    evaluate((text) => {
      const button = [...document.querySelectorAll("button")].find(
        (element) => element.textContent.trim() === text && !element.disabled,
      );
      button?.click();
      return Boolean(button);
    }, label),
  );
}

async function verifyApp(evaluate, name, version, profile) {
  const info = await evaluate(() => window.pi.getAppInfo());
  assert.equal(info.isDev, false);
  assert.equal(info.version, version);
  assert.equal(realpathSync.native(info.settingsDir).toLowerCase(), profile.toLowerCase());
  await waitFor(`${name} in the window`, () =>
    evaluate((title) => document.body.innerText.includes(title), name),
  );
}

async function sendTurn(evaluate, prompt) {
  await evaluate((text) => window.pi.agentPrompt(text), prompt);
  const saved = await waitFor("the saved demo reply", async () => {
    const state = await evaluate(() => window.pi.getSnapshot());
    const reply = state.messages.findLast(({ role }) => role === "assistant");
    return (
      state.status === "idle" &&
      reply?.parts.some(({ type, text }) => type === "text" && text.includes(prompt)) &&
      state
    );
  });
  await waitFor("the rendered conversation", () =>
    evaluate((text) => document.body.innerText.includes(text), prompt),
  );
  return saved;
}

function removeTestDirectory(directory) {
  if (!existsSync(directory)) return;
  assert.equal(realpathSync.native(directory).toLowerCase(), directory.toLowerCase());
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  assert.ok(!existsSync(directory));
}

function verifyPublishedFeed(directory) {
  const config = readFileSync(join(directory, "resources", "app-update.yml"), "utf8");
  assert.ok(config.split(/\r?\n/).includes(`url: ${updateUrl.href}`));
}

function serveUpdateFiles(request, response) {
  const path = new URL(request.url, updateUrl).pathname;
  const filename = /^(?:\/releases\/latest\/download|\/assets)\/([a-zA-Z0-9._-]+)$/.exec(path)?.[1];
  if (
    !filename ||
    !/^(?:latest\.yml|pi-desktop-[\w.-]+-x64-setup\.exe(?:\.blockmap)?)$/.test(filename)
  ) {
    response.writeHead(404).end();
    return;
  }
  if (path.startsWith(updateUrl.pathname)) {
    response.writeHead(302, { location: `/assets/${filename}` }).end();
    return;
  }
  const file = join(releaseDirectory, filename);
  if (!existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  updateRequests.add(filename);
  response.writeHead(200, {
    "content-length": statSync(file).size,
    "content-type": "application/octet-stream",
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    const stream = createReadStream(file);
    response.once("close", () => stream.destroy());
    stream.on("error", (error) => response.destroy(error)).pipe(response);
  }
}

async function waitForUpdate(evaluate, expected, version) {
  await waitFor(
    `update status ${expected}`,
    async () => {
      const status = await evaluate(() => window.pi.getUpdateStatus());
      assert.notEqual(status.state, "error", "The application reported an update error");
      return status.state === expected && (version === undefined || status.version === version);
    },
    60_000,
  );
}

assert.equal(process.platform, "win32");
assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "Run installation acceptance on the disposable Windows runner",
);
const [legacyInstaller, candidateInstaller, candidateVersion] = process.argv.slice(2);
assert.ok(
  legacyInstaller && candidateInstaller && candidateVersion && candidateVersion !== legacyVersion,
);

const legacyProfile = join(realpathSync.native(process.env.APPDATA), legacyName);
assert.ok(!existsSync(legacyProfile), "The runner must start with an unused legacy profile");
const publishedFeed = process.env.PILOT_PUBLISHED_UPDATE_URL;
const updateUrl = new URL(publishedFeed ?? process.env.PILOT_UPDATE_TEST_URL);
assert.equal(updateUrl.protocol, "https:");
const certificatePin = publishedFeed
  ? undefined
  : createHash("sha256")
      .update(
        new X509Certificate(readFileSync(process.env.PILOT_UPDATE_TEST_CERT)).publicKey.export({
          type: "spki",
          format: "der",
        }),
      )
      .digest("base64");
let releaseDirectory = dirname(resolve(legacyInstaller));
const updateRequests = new Set();
const feed = publishedFeed
  ? undefined
  : createHttpsServer(
      {
        pfx: readFileSync(process.env.PILOT_UPDATE_TEST_PFX),
        passphrase: process.env.PILOT_UPDATE_TEST_PASSPHRASE,
      },
      serveUpdateFiles,
    );
const root = mkdtempSync(join(realpathSync.native(process.env.RUNNER_TEMP), "pilot-install-"));
const cleanInstall = join(root, "clean-install");
const cleanProfile = join(root, "clean-profile");
const onboardingProfile = join(root, "onboarding-profile");
const upgradeInstall = join(root, "upgrade-install");
const skillFile = join(legacyProfile, "skills", skillId, "SKILL.md");
const updateCache = join(root, "local-app-data");
const archive = join("resources", "app.asar");

try {
  if (feed) {
    feed.listen(Number(updateUrl.port), "127.0.0.1");
    await once(feed, "listening");
  }
  mkdirSync(updateCache);
  mkdirSync(cleanProfile);
  runInstaller(resolve(candidateInstaller), root, ["/S", `/D=${cleanInstall}`]);
  if (publishedFeed) verifyPublishedFeed(cleanInstall);
  const expectedHash = createHash("sha256")
    .update(readFileSync(join(cleanInstall, archive)))
    .digest("hex");
  await withApp(cleanInstall, cleanProfile, async (evaluate) => {
    await verifyApp(evaluate, "Pilot", candidateVersion, cleanProfile);
    assert.deepEqual(await evaluate(async () => (await window.pi.getSnapshot()).sessions), []);
    await sendTurn(evaluate, "Hello from a clean Pilot install");
  });
  // The built-in demo works on a blank profile. A profile with no provider exercises the setup wizard.
  mkdirSync(onboardingProfile);
  writeFileSync(
    join(onboardingProfile, "settings.json"),
    JSON.stringify({ providers: [], activeProviderId: "" }),
  );
  await withApp(cleanInstall, onboardingProfile, async (evaluate) => {
    await click(evaluate, "开始配置");
    await click(evaluate, "下一步");
    await click(evaluate, "下一步");
    await click(evaluate, "完成配置");
    await waitFor("the demo provider to be enabled", () =>
      evaluate(async () =>
        (await window.pi.settingsGet()).activeProviderId.startsWith("onboarding-"),
      ),
    );
    await sendTurn(evaluate, "Hello after completing the Pilot setup wizard");
  });
  await uninstall(cleanInstall);
  console.log(
    `Clean Pilot ${candidateVersion} installation passed onboarding, a demo turn, and uninstall.`,
  );

  runInstaller(resolve(legacyInstaller), root, ["/S", `/D=${upgradeInstall}`]);
  if (publishedFeed) verifyPublishedFeed(upgradeInstall);
  const original = await withApp(upgradeInstall, legacyProfile, async (evaluate) => {
    await verifyApp(evaluate, legacyName, legacyVersion, legacyProfile);
    mkdirSync(join(legacyProfile, "skills", skillId), { recursive: true });
    writeFileSync(skillFile, skillBody);
    await evaluate(
      async (value, id) => {
        const settings = await window.pi.settingsGet();
        await window.pi.settingsSave({
          providers: settings.providers.map(({ hasKey, ...provider }) => provider),
          activeProviderId: settings.activeProviderId,
          approvalMode: "read-only",
          persona: value,
        });
        await window.pi.skillsToggle(id, true);
        localStorage.setItem("pi-locale", "en");
      },
      persona,
      skillId,
    );
    const { sessionId } = await sendTurn(evaluate, "This chat should survive the upgrade");
    assert.ok(sessionId);
    const transcript = await evaluate(
      async (id, title) => {
        await window.pi.sessionRename(id, title);
        return window.pi.sessionCopy(id);
      },
      sessionId,
      sessionTitle,
    );
    assert.ok(transcript.includes("This chat should survive the upgrade"));
    if (feed) {
      await waitForUpdate(evaluate, "current");
      releaseDirectory = dirname(resolve(candidateInstaller));
      updateRequests.clear();
    }
    await evaluate(() => {
      globalThis.pilotUpdateStates = [];
      window.pi.onUpdateStatus(({ state }) => globalThis.pilotUpdateStates.push(state));
      void window.pi.checkForUpdates();
    });
    await waitForUpdate(evaluate, "ready", candidateVersion);
    if (feed) {
      const updateStates = await evaluate(() => globalThis.pilotUpdateStates);
      for (const state of ["checking", "downloading", "ready"])
        assert.ok(updateStates.includes(state));
      assert.ok(updateRequests.has("latest.yml"));
      assert.ok(updateRequests.has(basename(candidateInstaller)));
    }
    return { sessionId, transcript };
  });

  // Quitting after download should leave the old version installed until the user approves.
  await withApp(
    upgradeInstall,
    legacyProfile,
    async (evaluate) => {
      await verifyApp(evaluate, legacyName, legacyVersion, legacyProfile);
      await waitForUpdate(evaluate, "ready", candidateVersion);
      await evaluate(() => {
        setTimeout(() => void window.pi.installUpdate(), 100);
      });
    },
    true,
  );

  const installedArchive = join(upgradeInstall, archive);
  await waitFor(
    "the updater to replace the installed package",
    () => {
      try {
        return (
          createHash("sha256").update(readFileSync(installedArchive)).digest("hex") === expectedHash
        );
      } catch (error) {
        if (["ENOENT", "EBUSY", "EACCES", "EPERM"].includes(error.code)) return false;
        throw error;
      }
    },
    60_000,
  );
  await delay(1_000);
  await withApp(upgradeInstall, legacyProfile, async (evaluate) => {
    await verifyApp(evaluate, "Pilot", candidateVersion, legacyProfile);
    const restored = await evaluate(async (id) => {
      const snapshot = await window.pi.sessionLoad(id);
      return {
        snapshot,
        transcript: await window.pi.sessionCopy(id),
        skills: await window.pi.skillsList(),
        locale: localStorage.getItem("pi-locale"),
      };
    }, original.sessionId);
    assert.equal(
      restored.snapshot.sessions.find(({ id }) => id === original.sessionId)?.title,
      sessionTitle,
    );
    assert.equal(restored.transcript, original.transcript);
    assert.equal(restored.snapshot.settings.approvalMode, "read-only");
    assert.equal(restored.snapshot.settings.persona, persona);
    assert.equal(restored.locale, "en");
    await waitFor("the restored English interface", () =>
      evaluate(() => document.documentElement.lang === "en"),
    );
    assert.equal(restored.skills.find(({ id }) => id === skillId)?.enabled, true);
    assert.equal(readFileSync(skillFile, "utf8"), skillBody);
    const continued = await sendTurn(evaluate, "This is the first turn after upgrading");
    assert.equal(continued.sessionId, original.sessionId);
    await waitForUpdate(evaluate, "current");
  });
  await uninstall(upgradeInstall);
  console.log(
    `${legacyName} ${legacyVersion} to Pilot ${candidateVersion} in-place upgrade preserved the transcript, settings, language, and enabled skill.`,
  );
  console.log("HTTPS update passed download, ordinary quit, explicit installation, and restart.");
  if (publishedFeed) console.log(`Published update feed verified at ${updateUrl.href}`);
} finally {
  if (feed) {
    feed.closeAllConnections();
    await new Promise((closed) => feed.close(closed));
  }
  try {
    await uninstall(upgradeInstall);
    await uninstall(cleanInstall);
  } finally {
    removeTestDirectory(legacyProfile);
    removeTestDirectory(root);
  }
}
console.log("Installation acceptance directories were removed.");
