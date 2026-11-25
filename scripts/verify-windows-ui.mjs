// @env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

import { stopProcessTree } from "./windows-process.mjs";
import { startModelFixture } from "./windows-ui/model.mjs";
import {
  prepareTerminalExit,
  verifyApprovals,
  verifyBackgroundTerminal,
  verifyCommandsAndTemplates,
  verifyFirstRun,
  verifyImageConversation,
  verifyImageDraft,
  verifyInstructionSourceLayouts,
  verifyInteractiveTerminal,
  verifyLayouts,
  verifyPlanDraft,
  verifyPlanExecution,
  verifyProjectInstructions,
  verifyRestoredPromptTemplates,
  verifyRestoredSettings,
  verifySearchAndExport,
  verifySettings,
  verifyStreamingReply,
  verifyUnsentDraft,
  verifyWebTools,
} from "./windows-ui/scenarios.mjs";

const require = createRequire(import.meta.url);
const repository = fileURLToPath(new URL("../", import.meta.url));
const startupError = /\bUncaught\b|\bUnhandledPromiseRejection\b|\[renderer\] process gone:/i;
const timeout = 15_000;

async function runScene(label, verify) {
  try {
    await verify();
    console.log("PASS " + label);
  } catch (error) {
    throw new Error(label + " failed", { cause: error });
  }
}

async function withApp(profile, verify) {
  const env = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [
      ".",
      "--user-data-dir=" + profile,
      "--remote-debugging-address=127.0.0.1",
      "--disable-backgrounding-occluded-windows",
    ],
    cwd: repository,
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
    await verify(page, window, app);

    // Let the debugger receive the IPC response before the app closes its window.
    const [[code]] = await Promise.all([
      once(child, "exit", { signal: AbortSignal.timeout(timeout) }),
      page.evaluate(() => setTimeout(() => void window.pi.menuAction("quit"), 50)),
    ]);
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

if (process.platform !== "win32") throw new Error("The desktop UI scenes require Windows");
assert.ok(
  existsSync(join(repository, "out", "renderer", "index.html")),
  "Run pnpm build before verifying the Windows UI",
);

const temp = realpathSync.native(tmpdir());
const scratch = realpathSync.native(mkdtempSync(join(temp, "pilot-windows-ui-")));
const profile = join(scratch, "profile");
const project = join(scratch, "fixture-project");
const commandProject = join(scratch, "commands-project");
const instructionProject = join(scratch, "instructions-project");
const imageFixture = {
  chosen: join(scratch, "chosen.png"),
  dropped: join(scratch, "dropped.png"),
  reference: join(commandProject, "image-context.txt"),
  outside: join(scratch, "outside.txt"),
};
let model;
let instructionSession;
try {
  mkdirSync(profile);
  mkdirSync(project);
  mkdirSync(commandProject);
  mkdirSync(instructionProject);
  execFileSync("git", ["init", "-q", commandProject]);
  writeFileSync(join(commandProject, "package.json"), JSON.stringify({
    scripts: { test: 'node -e "console.log(123456789)"' },
  }));
  model = await startModelFixture();
  await withApp(profile, async (page, window, app) => {
    await runScene("First-run model configuration", () =>
      verifyFirstRun(page, window, app, model, project),
    );
    await runScene("Edit a draft without starting a chat", () => verifyUnsentDraft(page));
  });
  await withApp(profile, async (page, window) => {
    await runScene("Restore the draft and create a chat on first send", () =>
      verifyStreamingReply(page, model),
    );
    await runScene("Allow and deny file writes", () =>
      verifyApprovals(page, window, model, project),
    );
    await runScene("Navigate settings and save", () => verifySettings(page));
    await runScene("Wide and narrow workbench layouts", () => verifyLayouts(page, window));
    await runScene("Draft and edit a read-only plan", () =>
      verifyPlanDraft(page, window, model, project),
    );
  });
  await withApp(profile, async (page, _window, app) => {
    await runScene("Restore preferences and conversation after restarting", () =>
      verifyRestoredSettings(page, model),
    );
    await runScene("Find transcript matches and export Markdown", () =>
      verifySearchAndExport(page, app, model, project),
    );
    await runScene("Restore and execute the approved plan", () =>
      verifyPlanExecution(page, model, project),
    );
    await runScene("Run shared commands and expand a prompt template", () =>
      verifyCommandsAndTemplates(page, app, model, project, commandProject),
    );
  });
  await withApp(profile, async (page, window) => {
    await runScene("Restore, edit, and remove a prompt template", () =>
      verifyRestoredPromptTemplates(page),
    );
    for (const path of [imageFixture.chosen, imageFixture.dropped])
      copyFileSync(join(repository, "resources", "icon.png"), path);
    writeFileSync(imageFixture.reference, "Project context for the image test.");
    writeFileSync(imageFixture.outside, "Outside the project.");
    await runScene("Choose, paste and drop images and reference project files", () =>
      verifyImageDraft(page, window, model, commandProject, imageFixture),
    );
  });
  await withApp(profile, async (page) => {
    await runScene("Restore an image draft and reopen the multimodal chat", () =>
      verifyImageConversation(page, model, commandProject),
    );
  });
  let terminalPid;
  await withApp(profile, async (page, window, app) => {
    await runScene("Type in PowerShell and Git Bash and check terminal controls", () =>
      verifyInteractiveTerminal(page, window, app, commandProject),
    );
    await runScene("Approve, read, and clean up Agent background commands", () =>
      verifyBackgroundTerminal(page, model, commandProject),
    );
    terminalPid = await prepareTerminalExit(page, app);
  });
  await runScene("Cancel exit with a terminal open, then quit and stop its shell", () =>
    assert.throws(() => process.kill(terminalPid, 0), { code: "ESRCH" }),
  );
  await withApp(profile, async (page, window, app) => {
    await runScene("Approve web requests, read sources, and revoke a domain grant", () =>
      verifyWebTools(page, window, app, model),
    );
    await runScene("Load project instructions for draft references and tool targets", async () => {
      instructionSession = await verifyProjectInstructions(page, app, model, instructionProject);
    });
  });
  await withApp(profile, async (page, window) => {
    await runScene("Restore instruction scopes and check wide and narrow dialog layouts", () =>
      verifyInstructionSourceLayouts(page, window, instructionSession),
    );
  });
} finally {
  try {
    await model?.close();
  } finally {
    assert.equal(dirname(scratch), temp);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.ok(!existsSync(scratch));
    console.log("Removed the Windows UI test profile and project");
  }
}
