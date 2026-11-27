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
import { startMcpOAuthFixture } from "./windows-ui/mcp-oauth.mjs";
import {
  prepareTerminalExit,
  verifyAgentMemory,
  verifyAfterTurnVerification,
  verifyApprovals,
  verifyAuxiliaryModels,
  verifyBackgroundTerminal,
  verifyCommandsAndTemplates,
  verifyDiscovery,
  verifyExternalEditor,
  verifyFirstRun,
  verifyGitAnnotations,
  verifyGitPublishing,
  verifyImageConversation,
  verifyImageDraft,
  verifyInstructionSourceLayouts,
  verifyInteractiveTerminal,
  verifyLayouts,
  verifyMcpOAuth,
  verifyParallelSessions,
  verifyRestoredMcpOAuth,
  verifyPlanDraft,
  verifyPlanExecution,
  verifyPluginPackages,
  verifyProjectConfiguration,
  verifyProjectInstructions,
  verifyProjectEntry,
  verifyQuickMemory,
  verifyRestoredMemory,
  verifyRestoredAfterTurnVerification,
  verifyRestoredPromptTemplates,
  verifyRestoredSettings,
  verifyRestoredExternalEditor,
  verifyRestoredAuxiliaryModels,
  verifyRestoredPluginPackages,
  verifyRestoredDiscovery,
  verifyRestoredProjectConfiguration,
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

async function withApp(profile, verify, project) {
  const env = { ...process.env };
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [
      ".",
      "--user-data-dir=" + profile,
      "--remote-debugging-address=127.0.0.1",
      "--disable-backgrounding-occluded-windows",
      ...(project ? [project] : []),
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
const utilityProfile = join(scratch, "auxiliary-model-profile");
const pluginProfile = join(scratch, "plugin-profile");
const discoveryProfile = join(scratch, "discovery-profile");
const projectConfigProfile = join(scratch, "project-config-profile");
const oauthProfile = join(scratch, "mcp-oauth-profile");
const parallelProfile = join(scratch, "parallel-profile");
const parallelProjects = ["Parallel project A", "Parallel project B", "Parallel project C"].map(
  (name) => join(scratch, name),
);
const oauthProject = join(scratch, "oauth-project");
const configurableProject = join(scratch, "configurable-project");
const discoveryMarket = join(scratch, "catalog fixture");
const pluginFixture = {
  root: join(scratch, "plugin fixture"),
  archive: join(scratch, "plugin-fixture.zip"),
  marker: join(scratch, "plugin-process.json"),
};
const project = join(scratch, "fixture-project");
const commandProject = join(scratch, "commands-project");
const instructionProject = join(scratch, "instructions-project");
const memoryProject = join(scratch, "memory-project");
const verificationProject = join(scratch, "verification-project");
const gitProject = join(scratch, "publishing-project");
const gitRemote = join(scratch, "publishing-remote.git");
const annotationRepository = join(scratch, "annotation-repository");
const externalEditorFixture = {
  launcher: process.execPath,
  script: join(scratch, "external editor capture.cjs"),
  output: join(scratch, "external editor arguments.json"),
  missing: join(scratch, "missing editor.exe"),
};
const entryProject = join(scratch, "启动 项目");
const secondEntryProject = join(scratch, "Next project & notes");
const imageFixture = {
  chosen: join(scratch, "chosen.png"),
  dropped: join(scratch, "dropped.png"),
  reference: join(commandProject, "image-context.txt"),
  outside: join(scratch, "outside.txt"),
};
let model;
let oauthFixture;
let instructionSession;
let memorySession;
let verificationSession;
try {
  mkdirSync(profile);
  mkdirSync(utilityProfile);
  mkdirSync(pluginProfile);
  mkdirSync(discoveryProfile);
  mkdirSync(projectConfigProfile);
  mkdirSync(oauthProfile);
  mkdirSync(oauthProject);
  mkdirSync(configurableProject);
  mkdirSync(project);
  mkdirSync(commandProject);
  mkdirSync(instructionProject);
  mkdirSync(memoryProject);
  mkdirSync(verificationProject);
  mkdirSync(gitProject);
  mkdirSync(annotationRepository);
  mkdirSync(entryProject);
  mkdirSync(secondEntryProject);
  execFileSync("git", ["init", "-q", commandProject]);
  writeFileSync(join(commandProject, "package.json"), JSON.stringify({
    scripts: { test: 'node -e "console.log(123456789)"' },
  }));
  model = await startModelFixture();
  for (const directory of parallelProjects) {
    mkdirSync(directory);
    execFileSync("git", ["init", "-q", "--template="], { cwd: directory });
    execFileSync("git", [
      "-c", "user.name=Pilot Desktop Test", "-c", "user.email=pilot@example.invalid",
      "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "Fixture baseline",
    ], { cwd: directory });
  }
  await withApp(parallelProfile, async (page, window, app) => {
    await runScene("Run, approve, stop and review tasks independently in separate projects", () =>
      verifyParallelSessions(page, window, app, model, parallelProjects, scratch),
    );
  }, parallelProjects[0]);
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
  await withApp(profile, async (page, window, app) => {
    await runScene("Restore instruction scopes and check wide and narrow dialog layouts", () =>
      verifyInstructionSourceLayouts(page, window, instructionSession),
    );
    await runScene("Preview, cancel, save and undo quick memory without creating a chat", () =>
      verifyQuickMemory(page, window, app, memoryProject),
    );
    await runScene("Review and save an Agent memory proposal to global personalization", async () => {
      memorySession = await verifyAgentMemory(page, model, memoryProject);
    });
  });
  await withApp(profile, async (page, window, app) => {
    await runScene("Restore saved memory and send a literal hash heading", () =>
      verifyRestoredMemory(page, model, memoryProject, memorySession),
    );
    await runScene("Configure after-turn verification and send a failed result to the original chat", async () => {
      verificationSession = await verifyAfterTurnVerification(page, window, app, model, verificationProject, memoryProject);
    });
  });
  await withApp(profile, async (page, window, app) => {
    await runScene("Restore automatic verification history and turn off the project command", () =>
      verifyRestoredAfterTurnVerification(page, model, verificationSession),
    );
    await runScene("Create and switch branches, preview commits, and push to a bare Git remote", () =>
      verifyGitPublishing(page, window, app, gitProject, gitRemote),
    );
    let annotations;
    await runScene("Send selected Git diff comments in one message with line references", async () => {
      annotations = await verifyGitAnnotations(page, window, app, model, annotationRepository);
    });
    await runScene("Save an external editor and open both a file preview and a Git line", () =>
      verifyExternalEditor(page, window, externalEditorFixture, annotations),
    );
  });
  await withApp(profile, async (page, window, app) => {
    await runScene("Restore the external editor preference after restarting", () =>
      verifyRestoredExternalEditor(page, externalEditorFixture),
    );
    await runScene("Open a cold and running window from the command line and drop a project", () =>
      verifyProjectEntry(page, window, app, {
        electron: require("electron"),
        repository,
        profile,
        caller: scratch,
        firstProject: entryProject,
        secondProject: secondEntryProject,
      }),
    );
  }, entryProject);
  let utilityChats;
  await withApp(utilityProfile, async (page, window) => {
    await runScene("Choose a utility model for titles and compaction while preserving manual titles", async () => {
      utilityChats = await verifyAuxiliaryModels(page, window, model);
    });
  });
  await withApp(utilityProfile, async (page) => {
    await runScene("Restore the utility setting and use the current chat model by default", () =>
      verifyRestoredAuxiliaryModels(page, model, utilityChats),
    );
  });
  await withApp(pluginProfile, async (page, window, app) => {
    await runScene("Review and install a plugin, use it with the agent, and confirm a fresh update", () =>
      verifyPluginPackages(page, window, app, model, pluginFixture),
    );
  });
  await withApp(pluginProfile, async (page) => {
    await runScene("Restore an updated plugin and remove its files, commands, and server", () =>
      verifyRestoredPluginPackages(page, pluginFixture, pluginProfile),
    );
  });
  await withApp(discoveryProfile, async (page, window, app) => {
    await runScene("Browse a Git marketplace and review MCP Registry configurations", () =>
      verifyDiscovery(page, window, app, discoveryMarket),
    );
  });
  await withApp(discoveryProfile, async (page) => {
    await runScene("Restore marketplace and MCP settings and remove the source independently", () =>
      verifyRestoredDiscovery(page),
    );
  });
  let trustedSession;
  await withApp(projectConfigProfile, async (page, window) => {
    await runScene("Review project sources, skip trust, then use a project MCP service and verification", async () => {
      trustedSession = await verifyProjectConfiguration(page, window, model, configurableProject);
    });
  }, configurableProject);
  await withApp(projectConfigProfile, async (page, _window, app) => {
    await runScene("Restore trust, check project settings sources, and revoke trust", () =>
      verifyRestoredProjectConfiguration(page, app, model, trustedSession, secondEntryProject),
    );
  });
  oauthFixture = await startMcpOAuthFixture();
  let oauthServer;
  await withApp(oauthProfile, async (page, window, app) => {
    await runScene("Authorize an MCP server in the browser, cancel safely, and store the grant", async () => {
      oauthServer = await verifyMcpOAuth(page, window, app, oauthFixture, oauthProfile);
    });
  });
  oauthFixture.expire();
  await withApp(oauthProfile, async (page, _window, app) => {
    await runScene("Refresh an MCP grant after restarting, sign in again, and isolate project credentials", () =>
      verifyRestoredMcpOAuth(page, app, model, oauthFixture, oauthProfile, oauthServer, oauthProject),
    );
  });
} finally {
  try {
    await Promise.all([model?.close(), oauthFixture?.close()]);
  } finally {
    assert.equal(dirname(scratch), temp);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    assert.ok(!existsSync(scratch));
    console.log("Removed the Windows UI test profile and project");
  }
}
