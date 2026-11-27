// @env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

import { stopProcessTree } from "../windows-process.mjs";

const wide = { width: 1100, height: 750 };
const narrow = { width: 720, height: 480 };
const streamPrompt = "Desktop stream scene";
const firstChunk = "The first part is visible";
const streamReply = firstChunk + " before the reply finishes.";
const approvalReply = "The desktop file approvals are complete.";
const draft = "Keep this draft while approval is pending.";
const instructions = "Use the desktop scene fixture when verifying this profile.";
const approvedFile = "approved.txt";
const deniedFile = "denied.txt";
const fileContents = "Approved in the desktop scene.\n";
const planPrompt = "Plan a change to a desktop fixture file.";
const plannedFile = "plan-mode.txt";
const revisedPlan = "1. Write the revised fixture note.\n2. Verify the file contents.";
const planningDraft = "Keep this draft while a plan awaits confirmation.";
const shellSearch = 'Write-Output "PilotFindCommand"';
const templateName = "audit-note";
const templateCommand = "/prompt-" + templateName;
const templateText = "Check {{file}} against {{rule}} and summarize {{file}}.";

const locales = [
  {
    lang: "zh-CN",
    name: "简体中文",
    settings: "设置",
    appearance: "外观",
    theme: "主题",
    light: "亮色",
    dark: "暗色",
    tabs: ["变更", "文件", "验证", "终端"],
    back: "返回对话",
    plan: "等待确认计划",
    editPlan: "编辑计划",
    discardPlan: "放弃计划",
    executePlan: "确认并执行",
    more: "更多操作",
    instructionSources: "指令来源",
    instructionOrder: "指令生效顺序",
    close: "关闭",
  },
  {
    lang: "en",
    name: "English",
    settings: "Settings",
    appearance: "Appearance",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    tabs: ["Changes", "Files", "Verify", "Terminal"],
    back: "Back to chat",
    plan: "Plan awaiting confirmation",
    editPlan: "Edit plan",
    discardPlan: "Discard plan",
    executePlan: "Confirm and execute",
    more: "More actions",
    instructionSources: "Instruction sources",
    instructionOrder: "Instruction order",
    close: "Close",
  },
];

function button(scope, name) {
  return scope.getByRole("button", { name, exact: typeof name === "string" });
}

function editor(page) {
  return page.locator("[data-composer-editor]");
}

async function resize(page, window, { width, height }, zoom = 1) {
  await window.evaluate(
    (win, size) => {
      win.webContents.setZoomFactor(size.zoom);
      win.setContentSize(size.width, size.height);
    },
    { width, height, zoom },
  );
  await page.waitForFunction(
    ([expectedWidth, expectedHeight]) =>
      Math.abs(innerWidth - expectedWidth) <= 1 && Math.abs(innerHeight - expectedHeight) <= 1,
    [width / zoom, height / zoom],
  );
}

async function assertFits(locator) {
  await locator.waitFor();
  await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (
      rect.left < -1 ||
      rect.right > innerWidth + 1 ||
      rect.top < -1 ||
      rect.bottom > innerHeight + 1 ||
      element.scrollWidth > element.clientWidth + 1
    ) {
      throw new Error(
        "Control is clipped at " + innerWidth + " × " + innerHeight + ": " + element.innerText,
      );
    }
  });
}

async function send(page, text) {
  await editor(page).fill(text);
  await page.keyboard.press("Enter");
}

async function waitForIdle(page) {
  await editor(page).waitFor();
  await button(page, "发送").waitFor();
}

async function openSettings(page, locale, section) {
  await button(page, locale.settings).click();
  const navigation = page.getByRole("navigation", { name: locale.settings, exact: true });
  await navigation.getByRole("searchbox").fill("");
  await button(navigation, section).click();
  await page.getByRole("heading", { name: section, exact: true }).waitFor();
}

export async function verifyFirstRun(page, window, app, model, project) {
  await resize(page, window, wide);
  await openSettings(page, locales[0], "模型与提供方");
  await page.getByRole("heading", { name: "Faux 测试", exact: true }).waitFor();
  // Removing the demo from this profile makes the first-run wizard available.
  await button(page, "删除提供方").click();
  await button(page, "保存").click();
  await page.getByText("已保存", { exact: true }).waitFor();
  await page.keyboard.press("Control+l");
  await button(page, "配置模型").click();
  const setup = page.getByRole("dialog", { name: "开始配置 Pilot" });
  await button(setup, /OpenAI 兼容/).click();
  await button(setup, "下一步").click();
  await setup.getByRole("textbox", { name: "Base URL" }).fill(model.baseUrl);
  await button(setup, "下一步").click();
  await button(setup, "浏览模型目录").click();
  await button(setup, model.modelId).click();
  await button(setup, "测试连接").click();
  const ping = await model.nextCompletion();
  assert.equal(ping.input.messages.at(-1).content, "ping");
  ping.write({ content: "OK" });
  ping.finish();
  await setup.getByText(/连接正常/).waitFor();
  await button(setup, "完成配置").click();
  await setup.waitFor({ state: "hidden" });
  await button(page, "配置模型").waitFor({ state: "hidden" });

  await openSettings(page, locales[0], "常规");
  const notifications = page.getByRole("switch", { name: "桌面通知", exact: true });
  assert.equal(await notifications.getAttribute("aria-checked"), "true");
  await notifications.click();
  await page.getByRole("switch", { name: "桌面通知", checked: false }).waitFor();
  await page.keyboard.press("Control+l");

  // Exercise the application's project entry with a deterministic native picker result.
  await app.evaluate(({ dialog }, folder) => {
    const showOpenDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async (_window, options) => {
      dialog.showOpenDialog = showOpenDialog;
      if (!options?.properties.includes("openDirectory"))
        throw new Error("Expected a directory picker");
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await page.keyboard.press("Control+o");
  await button(page.locator("main"), basename(project)).waitFor();
}

export async function verifyStreamingReply(page, model) {
  await editor(page).waitFor();
  assert.equal(await editor(page).innerText(), streamPrompt);
  const before = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(before.sessionId, null);
  assert.deepEqual(before.sessions, []);
  await editor(page).press("Enter");
  const reply = await model.nextCompletion();
  const after = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(after.sessionId, before.composerId);
  assert.equal(after.sessions.length, 1);
  await page.locator("[data-session-id]").waitFor();
  assert.equal(reply.input.messages.at(-1).content, streamPrompt);
  reply.write({ content: firstChunk });
  await page.getByText(firstChunk, { exact: true }).waitFor();
  await button(page, "停止").waitFor();
  reply.write({ content: streamReply.slice(firstChunk.length) });
  reply.finish();
  await page.getByText(streamReply, { exact: true }).waitFor();
  await button(page, "停止").waitFor({ state: "hidden" });
  await waitForIdle(page);
}

export async function verifyUnsentDraft(page) {
  const composer = editor(page);
  await composer.fill(streamPrompt);
  const draftStatus = () => page.evaluate(() => window.pi.getSnapshot());
  const typed = await draftStatus();
  assert.equal(typed.sessionId, null);
  assert.deepEqual(typed.sessions, []);
  assert.deepEqual(typed.composerDraft, [streamPrompt]);
  assert.equal(await page.locator("[data-session-id]").count(), 0);
  await composer.press("Shift+Tab");
  await button(page, "只读").waitFor();
  await composer.fill("/plan");
  await page.getByRole("option", { name: /^计划模式/ }).waitFor();
  await composer.press("Enter");
  await page.locator("[data-plan-mode]").waitFor();
  const planning = await draftStatus();
  assert.equal(planning.sessionId, null);
  assert.deepEqual(planning.sessions, []);
  assert.equal(planning.composerId, typed.composerId);
  await composer.fill("/plan");
  await composer.press("Enter");
  await page.locator("[data-plan-mode]").waitFor({ state: "hidden" });
  await composer.press("Shift+Tab");
  await button(page, "完全访问").waitFor();
  await composer.press("Shift+Tab");
  await button(page, "确认模式").waitFor();
  await composer.fill(streamPrompt);
  const saved = await draftStatus();
  assert.equal(saved.sessionId, null);
  assert.deepEqual(saved.sessions, []);
  assert.deepEqual(saved.composerDraft, [streamPrompt]);
}

export async function verifyApprovals(page, window, model, project) {
  await send(page, "Request two fixture file writes for review.");
  const reply = await model.nextCompletion();
  await editor(page).fill(draft);
  reply.write({
    tool_calls: [approvedFile, deniedFile].map((path, index) => ({
      index,
      id: "fixture-write-" + index,
      type: "function",
      function: { name: "write_file", arguments: JSON.stringify({ path, content: fileContents }) },
    })),
  });
  reply.finish("tool_calls");
  const approval = page.locator("[data-permission-card]");
  await approval.getByText(join(project, approvedFile), { exact: true }).waitFor();
  await approval.getByText(fileContents.trim(), { exact: true }).waitFor();
  assert.equal(existsSync(join(project, approvedFile)), false, "No write before approval");
  await editor(page).waitFor({ state: "hidden" });
  await resize(page, window, narrow);
  await assertFits(button(approval, "本次允许"));
  await assertFits(button(approval, "拒绝"));
  await page.waitForFunction(() => document.activeElement?.matches("[data-permission-card]"));
  await page.keyboard.press("Enter");
  await approval.getByText(join(project, deniedFile), { exact: true }).waitFor();
  assert.equal(existsSync(join(project, deniedFile)), false, "No write before denial");
  await page.waitForFunction(() => document.activeElement?.matches("[data-permission-card]"));
  await page.keyboard.press("Escape");

  const result = await model.nextCompletion();
  const tools = result.input.messages.filter(({ role }) => role === "tool");
  assert.deepEqual(
    tools.map(({ tool_call_id }) => tool_call_id),
    ["fixture-write-0", "fixture-write-1"],
  );
  assert.match(JSON.stringify(tools[1]), /用户拒绝了本次工具调用/);
  assert.equal(readFileSync(join(project, approvedFile), "utf8"), fileContents);
  assert.equal(existsSync(join(project, deniedFile)), false, "A denied write stays absent");
  result.write({ content: approvalReply });
  result.finish();
  await approval.waitFor({ state: "hidden" });
  await waitForIdle(page);
  assert.equal(await editor(page).innerText(), draft);
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
  await page.getByText(approvalReply, { exact: true }).waitFor();
}

export async function verifySettings(page) {
  await page.keyboard.press("Control+,");
  const search = page.getByRole("searchbox", { name: "搜索设置" });
  await search.fill("自定义指令");
  await search.press("Enter");
  await page.getByRole("heading", { name: "个性化", exact: true }).waitFor();
  const field = page.getByRole("textbox", { name: "自定义指令", exact: true });
  await field.fill(instructions);
  const save = button(page, "保存");
  await save.click();
  await page.getByRole("button", { name: "保存", exact: true, disabled: true }).waitFor();
  await page.getByRole("heading", { name: "个性化", exact: true }).waitFor();
}

async function selectAppearance(page, current, locale, theme, focusTarget = "[data-composer-editor]") {
  await openSettings(page, current, current.appearance);
  if (locale !== current) {
    await page.locator("#settings-language").click();
    await page.getByRole("option", { name: locale.name, exact: true }).click();
  }
  await page.waitForFunction((lang) => document.documentElement.lang === lang, locale.lang);
  await button(page.getByRole("group", { name: locale.theme }), locale[theme]).click();
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains("dark") === dark,
    theme === "dark",
  );
  await page.keyboard.press("Control+l");
  await page.waitForFunction((target) => document.activeElement?.matches(target), focusTarget);
}

export async function verifyDiagnostics(page, window, app, profile, scratch) {
  const secret = "pilot-diagnostic-fixture-credential";
  const record = {
    time: new Date().toISOString(),
    level: "error",
    source: "renderer",
    event: "process-gone",
    reason: "crashed",
    code: 7,
    path: secret,
    details: { message: secret },
    version: secret,
  };
  const files = join(profile, "logs");
  const line = JSON.stringify(record) + "\n";
  appendFileSync(join(files, "pilot.log"), line.repeat(225));
  writeFileSync(join(files, "pilot.log.1"), JSON.stringify({ ...record, code: 8, reason: secret }) + "\n");
  const events = await page.evaluate(() => window.pi.diagnosticEvents());
  assert.equal(events.length, 200);
  assert.equal(events[0].reason, "crashed");
  assert.ok(!JSON.stringify(events).includes(secret));

  const labels = [
    { section: "存储与诊断", open: "查看事件", title: "诊断事件", event: "进程退出", refresh: "刷新事件" },
    { section: "Storage and diagnostics", open: "View events", title: "Diagnostic events", event: "Process exited", refresh: "Refresh events" },
  ];
  let current = locales[0];
  let contrast = Infinity;
  for (const [index, locale] of locales.entries()) {
    const copy = labels[index];
    for (const theme of ["light", "dark"]) {
      await selectAppearance(page, current, locale, theme);
      current = locale;
      await openSettings(page, locale, copy.section);
      for (const size of [wide, narrow]) {
        await resize(page, window, size);
        const open = button(page, copy.open);
        await open.scrollIntoViewIfNeeded();
        await open.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: copy.title });
        const list = dialog.getByRole("region", { name: copy.title });
        await list.getByText(copy.event, { exact: true }).first().waitFor();
        await assertFits(dialog);
        await assertFits(button(dialog, locale.close));
        assert.equal(await list.getByRole("listitem").count(), 200);
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, p, time"));
        assert.ok(contrast >= 4.5, "Diagnostic text contrast " + contrast.toFixed(2));
        if (theme === "dark" && size === narrow) {
          await list.and(page.locator(":focus-visible")).waitFor();
          await page.keyboard.press("End");
          await list.evaluate((node) => {
            if (node.scrollHeight <= node.clientHeight) throw new Error("Expected a scrollable list");
          });
          await page.waitForFunction((title) =>
            [...document.querySelectorAll("section")].some(
              (node) => node.getAttribute("aria-label") === title && node.scrollTop > 0,
            ), copy.title);
          await page.keyboard.press("Tab");
          await button(dialog, copy.refresh).and(page.locator(":focus-visible")).waitFor();
          await page.keyboard.press("Enter");
          await list.getByText(copy.event, { exact: true }).first().waitFor();
        }
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction((label) => document.activeElement?.textContent.trim() === label, copy.open);
      }
      await page.keyboard.press("Control+l");
    }
  }
  console.log("Diagnostic text minimum contrast " + contrast.toFixed(2) + ":1");

  await selectAppearance(page, current, locales[0], "light");
  await openSettings(page, locales[0], labels[0].section);
  const save = button(page, "导出 JSON");
  const target = join(scratch, "诊断报告.json");
  const choose = (filePath) => app.evaluate(({ dialog }, filePath) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = async (parent, options) => {
      dialog.showSaveDialog = original;
      if (!parent || options.title !== "导出脱敏诊断" || options.defaultPath !== "pilot-diagnostics.json" ||
          options.filters[0].extensions[0] !== "json") throw new Error("Unexpected save dialog options");
      return filePath ? { canceled: false, filePath } : { canceled: true };
    };
  }, filePath);
  await choose(null);
  await save.click();
  await save.waitFor();
  assert.equal(await page.getByText("已导出脱敏诊断。", { exact: true }).count(), 0);
  assert.ok(!existsSync(target));
  await choose(files);
  await save.click();
  await page.getByRole("alert").getByText(/无法导出诊断/).waitFor();
  await choose(target);
  await save.click();
  await page.getByText("已导出脱敏诊断。", { exact: true }).waitFor();
  const json = readFileSync(target, "utf8");
  assert.ok(!json.includes(secret));
  assert.ok(!json.includes(profile));
  const { runtime, events: saved } = JSON.parse(json);
  assert.equal(runtime.platform, "win32");
  assert.match(runtime.electron, /^\d+\.\d+\.\d+$/);
  assert.match(runtime.node, /^\d+\.\d+\.\d+$/);
  assert.equal(saved.filter(({ reason }) => reason === "crashed").length, 225);
  assert.ok(saved.some(({ code, reason }) => code === 8 && reason === undefined));
}

export async function verifyCredentialMigration(page, app, profile, model) {
  const path = join(profile, "settings.json");
  const provider = {
    id: "diagnostics-model",
    name: "Migration fixture",
    kind: "openai-compatible",
    baseUrl: model.baseUrl,
    modelId: model.modelId,
  };
  const legacy = await app.evaluate(({ safeStorage }) =>
    safeStorage.encryptString("pilot-test-legacy-key").toString("base64"),
  );
  const input = { activeProviderId: provider.id, providers: [provider] };
  const savedInput = { ...input, providers: [{ ...provider, apiKey: "pilot-test-replacement-key" }] };
  writeFileSync(path, JSON.stringify({ ...input, providers: [{ ...provider, apiKey: legacy }] }));
  const original = readFileSync(path, "utf8");
  await app.evaluate(({ safeStorage }) => {
    const available = safeStorage.isAsyncEncryptionAvailable;
    const encrypt = safeStorage.encryptStringAsync;
    const decrypt = safeStorage.decryptStringAsync;
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    globalThis.pilotCredentialTest = { available, encrypt, decrypt, started, release, recovered: false };
    safeStorage.isAsyncEncryptionAvailable = async () => false;
  });
  let pending;
  try {
    await assert.rejects(page.evaluate((id) => window.pi.modelCatalog(id), provider.id), /系统密钥服务暂不可用/);
    await assert.rejects(page.evaluate((input) => window.pi.settingsSave(input), savedInput), /无法保存密钥/);
    assert.equal(readFileSync(path, "utf8"), original);
    await app.evaluate(({ safeStorage }) => {
      const state = globalThis.pilotCredentialTest;
      safeStorage.isAsyncEncryptionAvailable = state.available;
      safeStorage.decryptStringAsync = async (cipher) => {
        const result = await state.decrypt.call(safeStorage, cipher);
        state.recovered = result.result === "pilot-test-legacy-key";
        return result;
      };
      safeStorage.encryptStringAsync = async (plain) => {
        if (plain === "pilot-test-replacement-key") {
          state.started.resolve();
          await state.release.promise;
        }
        return state.encrypt.call(safeStorage, plain);
      };
    });
    assert.ok((await page.evaluate((id) => window.pi.modelCatalog(id), provider.id))
      .some(({ id }) => id === model.modelId));
    assert.equal(await app.evaluate(() => globalThis.pilotCredentialTest.recovered), true);

    pending = page.evaluate((input) => window.pi.settingsSave(input), savedInput);
    void pending.catch(() => {});
    await app.evaluate(() => Promise.race([
      globalThis.pilotCredentialTest.started.promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Provider encryption did not start")), 3_000).unref();
      }),
    ]));
    await page.evaluate(async () => {
      await window.pi.settingsSetLogLevel("debug");
      await window.pi.mcpSave({
        id: "d5980bef-3a5d-4a6b-9083-c310ad6a298b",
        name: "MCP migration fixture",
        enabled: false,
        policy: "confirm",
        transport: { type: "http", url: "https://example.test/mcp" },
        headers: [["Authorization", "Bearer pilot-test-mcp"]],
      });
    });
    await app.evaluate(() => { globalThis.pilotCredentialTest.release.resolve(); });
    const publicSettings = await pending;
    assert.equal(publicSettings.providers[0].hasKey, true);
    assert.ok(!Object.hasOwn(publicSettings.providers[0], "apiKey"));
    assert.equal(publicSettings.logLevel, "debug");

    const body = readFileSync(path, "utf8");
    assert.ok(!body.includes("pilot-test-"));
    const settings = JSON.parse(body);
    assert.equal(settings.logLevel, "debug");
    assert.notEqual(settings.providers[0].apiKey, legacy);
    assert.equal(await app.evaluate(({ safeStorage }, saved) => {
      const read = (cipher) => safeStorage.decryptString(Buffer.from(cipher, "base64"));
      return read(saved.providers[0].apiKey) === "pilot-test-replacement-key" &&
        JSON.parse(read(saved.mcpServers[0].encryptedHeaders))[0][1] === "Bearer pilot-test-mcp";
    }, settings), true);
  } finally {
    await app.evaluate(({ safeStorage }) => {
      const state = globalThis.pilotCredentialTest;
      if (!state) return;
      state.release.resolve();
      safeStorage.isAsyncEncryptionAvailable = state.available;
      safeStorage.encryptStringAsync = state.encrypt;
      safeStorage.decryptStringAsync = state.decrypt;
      delete globalThis.pilotCredentialTest;
    });
    await pending?.catch(() => {});
  }
}

export function seedStorageProfiles(legacy, newer) {
  mkdirSync(join(legacy, "sessions"), { recursive: true });
  mkdirSync(join(newer, "sessions"), { recursive: true });
  const legacyId = "48687a06-2cb0-43a1-a627-9752f1621f1b";
  const newerId = "7a6c4360-bb48-4cbd-ae92-b515fdd9ce8b";
  const legacyTranscript = JSON.stringify({
    role: "user", content: "Unversioned transcript", timestamp: 1,
  }) + "\n";
  const newerTranscript = '{"formatVersion":99,"type":"pilot_transcript"}\n{"future":true}\n';
  const newerSettings = '{"formatVersion":99,"futureSettings":{}}';
  const newerIndex = '{"formatVersion":98,"futureIndex":{}}';
  writeFileSync(join(legacy, "settings.json"), JSON.stringify({
    providers: [{ id: "faux-default", kind: "faux", name: "Faux 测试", modelId: "faux-default" }],
    activeProviderId: "faux-default",
    persona: "Keep this setting",
  }));
  writeFileSync(join(legacy, "sessions", "index.json"), JSON.stringify({
    sessions: [
      { id: legacyId, title: "Legacy chat", titleCustom: true, createdAt: 1, updatedAt: 1 },
      { id: newerId, title: "Newer chat", createdAt: 2, updatedAt: 2 },
    ],
  }));
  writeFileSync(join(legacy, "sessions", legacyId + ".jsonl"), legacyTranscript);
  writeFileSync(join(legacy, "sessions", legacyId + ".draft.json"), JSON.stringify(["Existing draft"]));
  writeFileSync(join(legacy, "sessions", newerId + ".jsonl"), newerTranscript);
  writeFileSync(join(newer, "settings.json"), newerSettings);
  writeFileSync(join(newer, "sessions", "index.json"), newerIndex);
  return { legacyId, newerId, legacyTranscript, newerTranscript, newerSettings, newerIndex };
}

export function seedBackupProfile(source, destination, archive) {
  const id = "48687a06-2cb0-43a1-a627-9752f1621f1b";
  const oldId = "7a6c4360-bb48-4cbd-ae92-4b8500d6ced7";
  const plugin = "backup-fixture";
  const skill = "backup-skill";
  for (const dir of [source, destination]) mkdirSync(join(dir, "sessions"), { recursive: true });
  const putChat = (dir, sessionId, title, message) => {
    writeFileSync(join(dir, "sessions", "index.json"), JSON.stringify({
      sessions: [{ id: sessionId, title, createdAt: 1, updatedAt: 1 }],
    }));
    writeFileSync(join(dir, "sessions", sessionId + ".jsonl"), JSON.stringify({
      role: "user", content: message, timestamp: 1,
    }) + "\n");
  };
  putChat(source, id, "Backed up chat", "Backed up transcript");
  putChat(destination, oldId, "Local-only chat", "Local transcript");
  writeFileSync(join(source, "sessions", id + ".draft.json"), JSON.stringify(["Backed up draft"]));
  mkdirSync(join(source, "skills", skill), { recursive: true });
  writeFileSync(join(source, "skills", skill, "SKILL.md"), "---\nname: Backup fixture\ndescription: Restored skill\n---\nKeep me.\n");
  mkdirSync(join(source, "imported-plugin-data", plugin), { recursive: true });
  writeFileSync(join(source, "imported-plugin-data", plugin, "asset.bin"), Buffer.from([0, 241, 255]));
  const corrupt = join(destination, "..", "坏备份.pilot-backup");
  writeFileSync(corrupt, "not a backup");
  return { id, oldId, source, destination, archive, corrupt, plugin, skill };
}

async function chooseBackup(app, kind, path) {
  await app.evaluate(({ dialog }, { kind, path }) => {
    const method = kind === "save" ? "showSaveDialog" : "showOpenDialog";
    const original = dialog[method];
    dialog[method] = async (parent, options) => {
      dialog[method] = original;
      if (!parent || options.filters[0].extensions[0] !== "pilot-backup")
        throw new Error("Expected a Pilot backup picker");
      return kind === "save"
        ? { canceled: !path, filePath: path }
        : { canceled: !path, filePaths: path ? [path] : [] };
    };
  }, { kind, path });
}

export async function verifyBackupExport(page, app, { source, archive, plugin }) {
  const { legacy, current } = await app.evaluate(async ({ safeStorage }) => ({
    legacy: safeStorage.encryptString("legacy-fixture-key").toString("base64"),
    current: (await safeStorage.encryptStringAsync("current-fixture-key")).toString("base64"),
  }));
  const models = [
    { id: "faux-default", name: "Faux", kind: "faux", modelId: "faux-default" },
    ...[["legacy", legacy], ["current", current], ["foreign", "bm90LXJlYWRhYmxl"]]
      .map(([id, apiKey]) => ({ id, apiKey, name: id, kind: "openai-compatible", modelId: id })),
  ];
  writeFileSync(join(source, "settings.json"), JSON.stringify({
    providers: models, activeProviderId: "faux-default", persona: "Restored persona",
    toolRules: [{ toolName: "read_file", pathPrefix: source }],
    importedPlugins: [{ id: plugin, name: "Backup fixture", source: "skill", partial: false, skillIds: [], serverIds: [] }],
    mcpServers: [{
      id: "7a6c4360-bb48-4cbd-ae92-4b8500d6ced7", name: "Foreign fixture", enabled: true, policy: "confirm",
      transport: { type: "http", url: "https://example.invalid/mcp" }, encryptedHeaders: "bm90LXJlYWRhYmxl",
    }],
  }));
  await openSettings(page, locales[0], "存储与诊断");
  await chooseBackup(app, "save", null);
  await button(page, "导出备份").click();
  await button(page, "导出备份").waitFor();
  assert.ok(!existsSync(archive));
  await chooseBackup(app, "save", archive);
  await button(page, "导出备份").click();
  await page.getByText("已导出数据备份。", { exact: true }).waitFor();
  assert.equal(readFileSync(archive).subarray(0, 2).toString("hex"), "1f8b");
}

export async function verifyBackupImport(page, window, app, fixture) {
  const { destination, archive, corrupt } = fixture;
  const staging = join(destination, ".pilot-restore");
  const labels = [
    { section: "存储与诊断", choose: "选择备份包", cancel: "取消", dialog: "恢复备份" },
    { section: "Storage and diagnostics", choose: "Choose backup", cancel: "Cancel", dialog: "Restore backup" },
  ];
  await openSettings(page, locales[0], labels[0].section);
  await chooseBackup(app, "open", null);
  await button(page, labels[0].choose).click();
  await button(page, labels[0].choose).waitFor();
  await chooseBackup(app, "open", corrupt);
  await button(page, labels[0].choose).click();
  await page.getByText(/请选择有效的 Pilot 备份/).waitFor();
  assert.ok(!existsSync(staging));
  let current = locales[0];
  for (const [index, locale] of locales.entries()) {
    const copy = labels[index];
    for (const theme of ["light", "dark"]) {
      await selectAppearance(page, current, locale, theme);
      current = locale;
      await openSettings(page, locale, copy.section);
      for (const size of [wide, narrow]) {
        await resize(page, window, size);
        await chooseBackup(app, "open", archive);
        const trigger = button(page, copy.choose);
        await trigger.scrollIntoViewIfNeeded();
        await trigger.press("Enter");
        const preview = page.getByRole("dialog", { name: copy.dialog, exact: true });
        await preview.getByText(basename(archive), { exact: true }).waitFor();
        await assertFits(preview);
        await preview.getByRole("table").waitFor();
        const cancel = button(preview, copy.cancel);
        await page.waitForFunction((name) => document.activeElement?.textContent === name, copy.cancel);
        await cancel.press("Escape");
        await preview.waitFor({ state: "hidden" });
        await page.waitForFunction((name) => document.activeElement?.textContent === name, copy.choose);
        assert.ok(!existsSync(staging));
      }
    }
  }
  await selectAppearance(page, current, locales[0], "light");
  await openSettings(page, locales[0], labels[0].section);
  await chooseBackup(app, "open", archive);
  await button(page, labels[0].choose).click();
  const confirm = button(page, "覆盖并重启");
  await confirm.waitFor();
  await page.evaluate(() => window.pi.settingsSetLogLevel("warn"));
  await confirm.click();
  await page.getByText(/本机数据已变化/).waitFor();
  await button(page.getByRole("dialog", { name: labels[0].dialog }), "取消").click();
  await chooseBackup(app, "open", archive);
  await button(page, labels[0].choose).click();
  await confirm.waitFor();
  await confirmBackupRestart(page, app, destination);
  assert.ok(existsSync(join(destination, "sessions", fixture.oldId + ".jsonl")));
}

async function confirmBackupRestart(page, app, profile) {
  const marker = join(profile, "requested-relaunch");
  await app.evaluate(({ app }, path) => {
    // Playwright owns the replacement process in the next scene.
    app.relaunch = () => process.mainModule.require("node:fs").writeFileSync(path, "1", { flag: "wx" });
  }, marker);
  const exited = once(app.process(), "exit", { signal: AbortSignal.timeout(15_000) });
  await button(page, "覆盖并重启").click({ noWaitAfter: true });
  const [status] = await exited;
  assert.equal(status, 0);
  assert.equal(readFileSync(marker, "utf8"), "1");
  assert.equal(JSON.parse(readFileSync(join(profile, ".pilot-restore", "state.json"), "utf8")).phase, "pending");
}

export async function verifyBackupSameProfile(page, app, { source, archive }) {
  await openSettings(page, locales[0], "存储与诊断");
  await chooseBackup(app, "open", archive);
  await button(page, "选择备份包").click();
  await page.getByText("恢复后需重新填写凭据或登录（提供方 1 项，MCP 服务 1 项）。", { exact: true }).waitFor();
  await confirmBackupRestart(page, app, source);
}

export async function verifyBackupRestored(page, app, fixture, keepKeys) {
  const { source, destination, id, oldId, plugin, skill } = fixture;
  const profile = keepKeys ? source : destination;
  const result = page.getByRole("dialog", { name: "已恢复数据备份" });
  await result.getByText("请在「模型与提供方」重新填写 " + (keepKeys ? 1 : 3) + " 项失效密钥。").waitFor();
  await result.getByText("请在「MCP 服务」重新填写凭据或登录（1 项）。").waitFor();
  await button(result, "知道了").click();
  await result.waitFor({ state: "hidden" });
  await resize(page, await app.browserWindow(page), wide);
  await page.locator('[data-session-id="' + id + '"]').click();
  await page.getByText("Backed up transcript", { exact: true }).waitFor();
  assert.equal(await editor(page).innerText(), "Backed up draft");
  const { settings } = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(settings.persona, "Restored persona");
  assert.deepEqual(settings.providers.map(({ hasKey }) => hasKey), [false, keepKeys, keepKeys, false]);
  assert.ok(settings.toolRules.some(({ toolName }) => toolName === "read_file"));
  assert.match(readFileSync(join(profile, "skills", skill, "SKILL.md"), "utf8"), /Keep me/);
  assert.deepEqual(readFileSync(join(profile, "imported-plugin-data", plugin, "asset.bin")), Buffer.from([0, 241, 255]));
  const saved = JSON.parse(readFileSync(join(profile, "settings.json"), "utf8"));
  assert.equal(saved.mcpServers[0].enabled, false);
  assert.ok(!Object.hasOwn(saved.mcpServers[0], "encryptedHeaders"));
  if (keepKeys) {
    assert.deepEqual(await app.evaluate(({ safeStorage }, keys) => keys.map((key) =>
      safeStorage.decryptString(Buffer.from(key, "base64")),
    ), saved.providers.slice(1, 3).map(({ apiKey }) => apiKey)), ["legacy-fixture-key", "current-fixture-key"]);
  }
  assert.ok(!existsSync(join(profile, "sessions", oldId + ".jsonl")));
  assert.ok(!existsSync(join(profile, ".pilot-restore")));
}

export async function verifyVersionedStorage(page, profile, fixture) {
  const { legacyId, newerId, legacyTranscript, newerTranscript } = fixture;
  const data = join(profile, "sessions");
  const legacyPath = join(data, legacyId + ".jsonl");
  const newerPath = join(data, newerId + ".jsonl");
  const settingsPath = join(profile, "settings.json");
  const indexPath = join(data, "index.json");
  await button(page, /^Legacy chat/).click();
  await page.getByText("Unversioned transcript", { exact: true }).waitFor();
  await editor(page).getByText("Existing draft", { exact: true }).waitFor();
  assert.equal(readFileSync(legacyPath, "utf8"), legacyTranscript);
  assert.equal(JSON.parse(readFileSync(settingsPath, "utf8")).formatVersion, undefined);

  const newerChat = button(page, /^Newer chat/);
  await newerChat.press("Enter");
  await page.locator("[data-feedback-bar]").getByText("此数据文件来自较新版 Pilot。请升级 Pilot 后重试。", { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.pi.getSnapshot())).sessionId, legacyId);
  await newerChat.click({ button: "right" });
  await page.getByRole("menuitem", { name: "分叉", exact: true }).click();
  await page.locator("[data-feedback-bar]").getByText("无法分叉聊天。", { exact: true }).waitFor();
  await assert.rejects(page.evaluate((id) => window.pi.sessionDelete(id), newerId), /升级 Pilot/);
  assert.equal(readFileSync(newerPath, "utf8"), newerTranscript);

  await page.evaluate(async (id) => {
    await window.pi.settingsSetLogLevel("warn");
    await window.pi.sessionSaveDraft(id, ["Saved draft"]);
  }, legacyId);
  assert.deepEqual(JSON.parse(readFileSync(join(data, legacyId + ".draft.json"), "utf8")), {
    formatVersion: 1, entries: ["Saved draft"],
  });
  const savedSettings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(savedSettings.formatVersion, 1);
  assert.equal(savedSettings.persona, "Keep this setting");
  await send(page, "Versioned follow-up");
  await page.getByText(/faux.*Versioned follow-up/i).waitFor();
  await waitForIdle(page);
  const [header] = readFileSync(legacyPath, "utf8").split("\n");
  assert.deepEqual(JSON.parse(header), { type: "pilot_transcript", formatVersion: 1 });
  assert.equal(JSON.parse(readFileSync(indexPath, "utf8")).formatVersion, 1);
}

export async function verifyStorageUpgradeNotice(page, window, app, profile, fixture) {
  const settingsPath = join(profile, "settings.json");
  const indexPath = join(profile, "sessions", "index.json");
  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  assert.deepEqual(snapshot.settings.recovery, { status: "upgrade", path: settingsPath, version: 99 });
  assert.deepEqual(snapshot.sessionStorageUpgrade, { path: indexPath, version: 98 });
  await assert.rejects(page.evaluate(() => window.pi.settingsSetLogLevel("debug")), /升级 Pilot/);
  assert.equal(await editor(page).count(), 0);
  const labels = [
    { title: "需要新版 Pilot", link: "全部版本" },
    { title: "A newer version of Pilot is required", link: "All releases" },
  ];
  let current = locales[0];
  let contrast = Infinity;
  for (const [index, locale] of locales.entries()) {
    const { title, link } = labels[index];
    for (const theme of ["light", "dark"]) {
      await openSettings(page, current, current.appearance);
      if (locale !== current) {
        await page.locator("#settings-language").click();
        await page.getByRole("option", { name: locale.name, exact: true }).click();
      }
      await button(page.getByRole("group", { name: locale.theme }), locale[theme]).click();
      current = locale;
      await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, theme === "dark");
      const alerts = page.getByRole("alert").filter({ hasText: title });
      await alerts.first().waitFor();
      assert.equal(await alerts.count(), 2);
      await page.keyboard.press("Control+l");
      for (const size of [wide, narrow]) {
        await resize(page, window, size);
        for (const alert of await alerts.all()) {
          await alert.scrollIntoViewIfNeeded();
          await assertFits(alert);
          contrast = Math.min(contrast, await minimumTextContrast(alert, '[data-slot="alert-title"], p'));
          const upgrade = alert.getByText(link, { exact: true });
          assert.equal(await upgrade.getAttribute("href"), "https://github.com/Murmureeee/Pilot/releases");
        }
      }
    }
  }
  assert.ok(contrast >= 4.5, "Upgrade notice text contrast " + contrast.toFixed(2) + ":1");
  console.log("Upgrade notice text minimum contrast " + contrast.toFixed(2) + ":1");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setWindowOpenHandler(({ url }) => {
      globalThis.pilotVersionLink = url;
      return { action: "deny" };
    });
  });
  await page.getByText("All releases", { exact: true }).first().press("Enter");
  const end = performance.now() + 3_000;
  while (!(await app.evaluate(() => globalThis.pilotVersionLink)) && performance.now() < end) {
    await delay(50);
  }
  assert.equal(await app.evaluate(() => globalThis.pilotVersionLink), "https://github.com/Murmureeee/Pilot/releases");
  assert.equal(readFileSync(settingsPath, "utf8"), fixture.newerSettings);
  assert.equal(readFileSync(indexPath, "utf8"), fixture.newerIndex);
  assert.ok(!readdirSync(profile).some((name) => name.startsWith("settings.corrupt-")));
  assert.deepEqual(readdirSync(join(profile, "sessions")), ["index.json"]);
}

async function verifyReviewLayout(page, locale, overlay) {
  const trigger = page.locator("#review-trigger");
  await trigger.click();
  const review = page.locator("[data-review-layout]");
  await review.waitFor();
  assert.equal(await review.getAttribute("data-review-layout"), overlay ? "overlay" : "split");
  assert.equal(await page.locator("main").evaluate((node) => node.inert), overlay);
  const [changes, files, validation, terminal] = locale.tabs;
  await assertFits(review.getByRole("tab", { name: new RegExp("^" + changes) }));
  await assertFits(review.getByRole("tab", { name: files, exact: true }));
  await assertFits(review.getByRole("tab", { name: validation, exact: true }));
  await assertFits(review.getByRole("tab", { name: terminal, exact: true }));
  if (overlay) await assertFits(button(review, locale.back));
  await page.waitForFunction(() =>
    document.activeElement?.matches('[role="tab"][aria-selected="true"]'),
  );
  await page.keyboard.press("Escape");
  await review.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.id === "review-trigger");
}

async function verifyFindLayout(page) {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: /^(Search|搜索)$/ });
  await assertFits(palette);
  await assertFits(palette.getByRole("textbox"));
  await assertFits(palette.getByRole("combobox"));
  for (const tab of await palette.getByRole("button", { pressed: false }).all()) await assertFits(tab);
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });

  await page.keyboard.press("Control+f");
  const bar = page.locator("[data-chat-find]");
  const field = bar.locator("[data-chat-find-input]");
  await field.fill("Desktop");
  await assertFits(bar);
  for (const control of await bar.getByRole("button").all()) await assertFits(control);
  await field.press("Escape");
  await bar.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.id === "review-trigger");

  const composer = editor(page);
  const original = await composer.innerText();
  await composer.fill("/permissions");
  await composer.press("End");
  await assertFits(page.getByRole("option", { selected: true }).filter({ hasText: "/permissions" }));
  await composer.press("Escape");
  await composer.fill(original);
}

export async function verifyLayouts(page, window) {
  let current = locales[0];
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await assertFits(editor(page));
        await verifyReviewLayout(page, locale, size === narrow);
        await verifyFindLayout(page);
        console.log(
          "Checked " + size.width + " × " + size.height + " " + locale.lang + " " + theme,
        );
      }
    }
  }

  await resize(page, window, narrow, 1.5);
  await verifyReviewLayout(page, current, true);
  await verifyFindLayout(page);
  await page.keyboard.press("Control+Shift+s");
  await page.waitForFunction(() => document.querySelector("main")?.inert);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "sidebar-toggle");
  await page.keyboard.press("Control+l");
  await assertFits(editor(page));
  await resize(page, window, wide);
}

function sendTool(completion, id, name, args, usage) {
  completion.write({
    tool_calls: [
      {
        index: 0,
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  completion.finish("tool_calls", usage);
}

const projectMemory = "Use the project's integration fixtures.";
const globalMemory = "Quote file paths in explanations.";
const memoryPrompt = "Please remember to cite file paths in all my chats.";

export async function verifyQuickMemory(page, window, app, project) {
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await page.keyboard.press("Control+o");
  await waitForProjectDraft(page, project);
  const composer = editor(page);
  const draft = "# " + projectMemory;
  const path = join(project, "AGENTS.md");
  await composer.fill(draft);
  let current = locales[1];
  let contrast = Infinity;
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      const en = locale.lang === "en";
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await composer.press("Enter");
        const dialog = page.getByRole("dialog", { name: en ? "Review memory" : "审阅记忆" });
        const instruction = dialog.getByRole("textbox", { name: en ? "Instruction" : "约定内容" });
        await instruction.waitFor();
        assert.equal(await instruction.inputValue(), projectMemory);
        await assertFits(dialog);
        await assertFits(button(dialog, en ? "Preview changes" : "预览差异"));
        await button(dialog, en ? "Preview changes" : "预览差异").press("Enter");
        const diff = dialog.getByRole("region", { name: en ? "Proposed memory changes" : "拟议记忆差异" });
        await diff.getByText(projectMemory, { exact: true }).waitFor();
        await assertFits(button(dialog, en ? "Save memory" : "保存记忆"));
        assert.equal(await diff.evaluate((element) => element === document.activeElement), true);
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, p"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
        assert.equal(await composer.innerText(), draft);
        console.log("Checked memory at " + size.width + " × " + size.height + " " + locale.lang + " " + theme);
      }
    }
  }
  assert.ok(contrast >= 4.5, "Memory review text must meet the contrast requirement");
  console.log("Memory review text minimum contrast " + contrast.toFixed(2) + ":1");
  assert.ok(!existsSync(path));
  assert.equal((await page.evaluate(() => window.pi.getSnapshot())).sessionId, null);

  await resize(page, window, narrow, 1.5);
  await composer.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review memory" });
  const scope = dialog.getByRole("combobox", { name: "Save to" });
  await scope.press("Enter");
  await page.getByRole("option", { name: "Global personalization", exact: true }).press("Enter");
  await button(dialog, "Preview changes").press("Enter");
  await dialog.getByText("Settings → Personalization → Custom instructions", { exact: true }).waitFor();
  await assertFits(dialog);
  await assertFits(button(dialog, "Save memory"));
  await button(dialog, "Back to editing").press("Enter");
  await scope.press("Enter");
  await page.getByRole("option", { name: "Project instructions", exact: true }).press("Enter");
  for (const undo of [true, false]) {
    await button(dialog, "Preview changes").press("Enter");
    await dialog.getByText(path, { exact: true }).waitFor();
    assert.ok(!existsSync(path));
    await button(dialog, "Save memory").press("Enter");
    await dialog.getByText("Memory saved", { exact: true }).waitFor();
    assert.equal(readFileSync(path, "utf8"), projectMemory + "\n");
    if (undo) {
      await button(dialog, "Undo save").press("Enter");
      await dialog.getByText("Memory undone", { exact: true }).waitFor();
      assert.ok(!existsSync(path));
    }
    await button(dialog, "Done").press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
    if (undo) await composer.press("Enter");
  }
  assert.equal(await composer.innerText(), "");
  assert.equal((await page.evaluate(() => window.pi.getSnapshot())).sessionId, null);
  await resize(page, window, wide);
}

export async function verifyAgentMemory(page, model, project) {
  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  const initial = snapshot.settings.persona;
  await send(page, memoryPrompt);
  const first = await model.nextCompletion();
  assert.ok(JSON.stringify(first.input.messages).includes(projectMemory));
  assert.ok(first.input.tools.some(({ function: { name } }) => name === "propose_memory"));
  sendTool(first, "memory-suggestion", "propose_memory", { text: "Mention file paths in replies.", scope: "global" });
  const reply = await model.nextCompletion();
  assert.match(reply.input.messages.at(-1).content, /proposal is ready/);
  reply.write({ content: "You can now review the proposed memory." });
  reply.finish();
  await button(page, "Send").waitFor();
  const open = button(page, "Review memory…");
  await open.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Review memory" });
  const instruction = dialog.getByRole("textbox", { name: "Instruction" });
  assert.equal(await instruction.inputValue(), "Mention file paths in replies.");
  await instruction.fill(globalMemory);
  await button(dialog, "Preview changes").press("Enter");
  await dialog.getByText("Settings → Personalization → Custom instructions", { exact: true }).waitFor();
  await dialog.getByRole("region").getByText(globalMemory, { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.pi.settingsGet())).persona, initial);
  await button(dialog, "Save memory").press("Enter");
  await dialog.getByText("Memory saved", { exact: true }).waitFor();
  assert.ok((await page.evaluate(() => window.pi.settingsGet())).persona.endsWith(globalMemory + "\n"));
  await button(dialog, "Done").click();
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Review memory…");
  assert.equal(readFileSync(join(project, "AGENTS.md"), "utf8"), projectMemory + "\n");
  return (await page.evaluate(() => window.pi.getSnapshot())).sessionId;
}

export async function verifyRestoredMemory(page, model, project, sessionId) {
  await page.evaluate((id) => window.pi.sessionLoad(id), sessionId);
  await button(page, "Review memory…").waitFor();
  const heading = "# Markdown heading";
  await send(page, heading);
  await button(page.getByRole("dialog", { name: "Review memory" }), "Send as message").press("Enter");
  const prompt = await model.nextCompletion();
  assert.equal(prompt.input.messages.at(-1).content, heading);
  assert.ok(JSON.stringify(prompt.input.messages).includes(projectMemory));
  assert.ok(JSON.stringify(prompt.input.messages).includes(globalMemory));
  assert.match(readFileSync(join(project, "AGENTS.md"), "utf8"), /integration fixtures/);
  prompt.write({ content: "Both instruction scopes were restored." });
  prompt.finish();
  await page.getByText("Both instruction scopes were restored.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
}

export async function verifyProjectHooks(page, window, model, project) {
  const beforeCommand = 'Write-Output ("hook before " + $env:PILOT_HOOK_TOOL)';
  const afterCommand = 'Write-Output ("hook after " + $env:PILOT_HOOK_TOOL)';
  const turnCommand = 'Write-Output "hook turn"';
  writeFileSync(join(project, "notes.txt"), "Hook desktop fixture.\n");
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "hooks", kind: "openai-compatible", name: "Hook fixture", baseUrl, modelId }],
      activeProviderId: "hooks",
    });
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await waitForProjectDraft(page, project);

  const showHooks = async (locale) => {
    const en = locale.lang === "en";
    await openSettings(page, locale, en ? "General" : "常规");
    const trigger = button(page, en ? "Configure hooks…" : "配置钩子…");
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: en ? "Project hooks" : "项目钩子" });
    await dialog.waitFor();
    return { dialog, trigger };
  };
  let current = locales[0];
  let minimum = Infinity;
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const { dialog, trigger } = await showHooks(locale);
        await assertFits(dialog);
        minimum = Math.min(minimum, await minimumTextContrast(dialog, "h2, p, label"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus")).waitFor();
      }
    }
  }
  assert.ok(minimum >= 4.5, "Project hook text contrast " + minimum.toFixed(2) + ":1");
  await resize(page, window, narrow, 1.5);
  const { dialog, trigger } = await showHooks(current);
  await dialog.getByRole("textbox", { name: "Before-tool hook" }).fill(beforeCommand);
  await dialog.getByRole("textbox", { name: "After-tool hook" }).fill(afterCommand);
  await dialog.getByRole("textbox", { name: "After-turn hook" }).fill(turnCommand);
  await button(dialog, "Save").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();
  await page.keyboard.press("Control+l");
  await resize(page, window, wide);

  await send(page, "Read the Hook desktop fixture.");
  const first = await model.nextCompletion();
  sendTool(first, "hook-read", "read_file", { path: "notes.txt" });
  const afterRead = await model.nextCompletion();
  assert.match(JSON.stringify(afterRead.input.messages.at(-1)), /Hook desktop fixture/);
  assert.doesNotMatch(JSON.stringify(afterRead.input.messages), /hook before read_file|hook after read_file/);
  afterRead.write({ content: "Finished the hook fixture." });
  afterRead.finish();
  await button(page, "Send").waitFor();
  const openTrace = async () => {
    const activity = page.locator("[data-reply-activity] > [data-slot=trace-collapsible] > [data-slot=trace-collapsible-trigger]").first();
    await activity.press("Enter");
    for (const [name, output] of [
      ["Before-tool hook", "hook before read_file"],
      ["After-tool hook", "hook after read_file"],
      ["After-turn hook", "hook turn"],
    ]) {
      const line = page.getByRole("button", { name: new RegExp(name) });
      assert.match(await line.innerText(), /\d+(?:\.\d+)?\s+s\b/i);
      await line.press("Enter");
      await page.getByText(output, { exact: true }).waitFor();
    }
  };
  await openTrace();
  await page.reload();
  await page.getByText("Finished the hook fixture.", { exact: true }).waitFor();
  await openTrace();
  console.log("Hook configuration contrast " + minimum.toFixed(2) + ":1");
}

const afterTurnCommand = "node check-after-turn.cjs";
const afterTurnFailure = "The fixture needs fixed.txt";
const afterTurnSuccess = "The after-turn check passed";

export async function verifyAfterTurnVerification(page, window, app, model, project, otherProject) {
  writeFileSync(join(project, "check-after-turn.cjs"), [
    "const fs = require('node:fs');",
    "fs.appendFileSync('after-turn.log', process.cwd() + '\\n');",
    `if (fs.existsSync('fixed.txt')) console.log(${JSON.stringify(afterTurnSuccess)});`,
    `else { console.error(${JSON.stringify(afterTurnFailure)}); process.exitCode = 7; }`,
  ].join("\n"));
  const log = join(project, "after-turn.log");
  const openProject = async (directory) => {
    await app.evaluate(({ dialog }, folder) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [folder] };
      };
    }, directory);
    await page.keyboard.press("Control+o");
    await waitForProjectDraft(page, directory);
  };
  const panel = page.locator("[data-verification-panel]");
  const openConfiguration = async (locale) => {
    const en = locale.lang === "en";
    await page.keyboard.press("Control+Shift+t");
    const trigger = button(panel, en ? "Configure after-turn verification…" : "配置回合后验证…");
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: en ? "After-turn verification" : "回合后验证" });
    const command = dialog.getByRole("textbox", { name: en ? "Command" : "命令", exact: true });
    await command.waitFor();
    return { dialog, command, trigger };
  };

  await openProject(project);
  let current = locales[1];
  let contrast = Infinity;
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const { dialog, command, trigger } = await openConfiguration(locale);
        await assertFits(dialog);
        await assertFits(command);
        await command.fill(afterTurnCommand);
        await assertFits(button(dialog, locale.lang === "en" ? "Save" : "保存"));
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, p, dt, dd, label"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await page.waitForFunction((label) => document.activeElement?.textContent?.trim() === label, await trigger.innerText());
        console.log("Checked after-turn verification at " + size.width + " × " + size.height + " " + locale.lang + " " + theme);
      }
    }
  }
  assert.ok(contrast >= 4.5, "Verification configuration text must meet the contrast requirement");
  console.log("After-turn verification text minimum contrast " + contrast.toFixed(2) + ":1");
  await page.keyboard.press("Control+l");
  await resize(page, window, narrow, 1.5);
  const { dialog, command } = await openConfiguration(current);
  assert.equal(await command.inputValue(), "");
  await command.fill(afterTurnCommand);
  await assertFits(dialog);
  await button(dialog, "Save").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await panel.locator('[data-after-turn-verification="enabled"]').getByText(afterTurnCommand, { exact: true }).waitFor();
  const draft = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(draft.sessionId, null);
  await page.keyboard.press("Control+l");
  await resize(page, window, wide);

  await send(page, "Implement the after-turn verification fixture.");
  const first = await model.nextCompletion();
  assert.ok(!existsSync(log));
  sendTool(first, "after-turn-read", "read_file", { path: "check-after-turn.cjs" });
  const next = await model.nextCompletion();
  assert.ok(!existsSync(log), "Interim tool calls must not trigger verification");
  await openProject(otherProject);
  next.write({ content: "The fixture turn is complete." });
  next.finish();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);
  const other = await page.evaluate(async () => {
    const { composerId } = await window.pi.getSnapshot();
    return window.pi.sessionVerification(composerId);
  });
  assert.equal(other.project.directory, otherProject);
  assert.equal(other.project.afterTurn, undefined);
  assert.deepEqual(other.runs, []);

  await page.evaluate((id) => window.pi.sessionLoad(id), draft.composerId);
  await editor(page).fill("Keep this draft while the agent repairs the fixture.");
  await resize(page, window, narrow);
  await page.keyboard.press("Control+Shift+t");
  const details = panel.locator('[data-verification-trigger="after-turn"]');
  await details.locator('[data-verification-status="failed"]').waitFor();
  assert.equal(await details.locator("[data-verification-exit-code]").innerText(), "7");
  await details.locator("[data-verification-output]").getByText(afterTurnFailure).waitFor();
  const failed = await page.evaluate((id) => window.pi.sessionVerification(id), draft.composerId);
  assert.equal(failed.runs.length, 1);
  assert.equal(failed.runs[0].workingDirectory, project);
  assert.equal(failed.runs[0].task.title, "Implement the after-turn verification fixture.");
  assert.equal(readFileSync(log, "utf8").trim(), project);

  await button(details, "Send to agent to fix").press("Enter");
  const repair = await model.nextCompletion();
  const repairText = repair.input.messages.at(-1).content;
  for (const detail of [project, afterTurnCommand, "Exit code 7", afterTurnFailure])
    assert.ok(repairText.includes(detail));
  await panel.waitFor({ state: "hidden" });
  assert.equal(await editor(page).innerText(), "Keep this draft while the agent repairs the fixture.");
  sendTool(repair, "after-turn-fix", "write_file", { path: "fixed.txt", content: "fixture fixed" });
  await button(page.locator("[data-permission-card]"), "Allow once").press("Enter");
  const fixed = await model.nextCompletion();
  fixed.write({ content: "The fixture file is fixed." });
  fixed.finish();
  await page.getByText("The fixture file is fixed.", { exact: true }).waitFor();
  await page.keyboard.press("Control+Shift+t");
  await details.locator('[data-verification-status="success"]').waitFor();
  await details.locator("[data-verification-output]").waitFor({ state: "hidden" });
  await resize(page, window, wide);
  return draft.composerId;
}

export async function verifyRestoredAfterTurnVerification(page, model, sessionId) {
  await page.evaluate((id) => window.pi.sessionLoad(id), sessionId);
  await page.getByText("The fixture file is fixed.", { exact: true }).waitFor();
  await page.locator("#review-trigger").press("Enter");
  await page.getByRole("tab", { name: /^Verify/ }).press("Enter");
  const panel = page.locator("[data-verification-panel]");
  await panel.locator('[data-after-turn-verification="enabled"]').getByText(afterTurnCommand, { exact: true }).waitFor();
  const state = () => page.evaluate((id) => window.pi.sessionVerification(id), sessionId);
  const saved = await state();
  assert.deepEqual(saved.runs.map(({ status, trigger }) => [status, trigger]), [
    ["success", "after-turn"], ["failed", "after-turn"],
  ]);
  await button(panel, "Configure after-turn verification…").press("Enter");
  const dialog = page.getByRole("dialog", { name: "After-turn verification" });
  await button(dialog, "Turn off after-turn verification").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await panel.locator('[data-after-turn-verification="disabled"]').waitFor();
  await page.keyboard.press("Control+l");
  await send(page, "Complete a turn with the automatic check off.");
  const reply = await model.nextCompletion();
  reply.write({ content: "The final fixture turn is complete." });
  reply.finish();
  await page.getByText("The final fixture turn is complete.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  const disabled = await state();
  assert.equal(disabled.project.afterTurn, undefined);
  assert.deepEqual(disabled.runs, saved.runs);
}

async function openInstructionSources(page, locale) {
  const trigger = button(page.locator("main"), locale.more);
  await trigger.press("Enter");
  await page.getByRole("menuitem", { name: locale.instructionSources + "…", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: locale.instructionSources, exact: true });
  await dialog.waitFor();
  const order = dialog.getByRole("region", { name: locale.instructionOrder, exact: true });
  return { dialog, order, trigger };
}

async function closeInstructionSources(page, { dialog, trigger }) {
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction((label) => document.activeElement?.getAttribute("aria-label") === label,
    await trigger.getAttribute("aria-label"));
}

export async function verifyProjectInstructions(page, app, model, project) {
  const files = {
    "CLAUDE.md": "Fixture root guidance",
    "features/CLAUDE.md": "Fixture parent guidance",
    "features/forms/AGENTS.md": "Fixture form guidance",
    "features/forms/CLAUDE.md": "Fixture shadowed guidance",
    "features/forms/scope-note.txt": "Use this file to find form guidance.",
    "delivery/AGENTS.md": "Fixture delivery guidance",
  };
  for (const path of ["features/forms", "delivery"])
    mkdirSync(join(project, path), { recursive: true });
  for (const [path, content] of Object.entries(files)) writeFileSync(join(project, path), content);
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+o");
  await waitForProjectDraft(page, project);

  const composer = editor(page);
  await composer.fill("Check @scope-note");
  await composer.press("End");
  await page.getByRole("option", { name: /^scope-note\.txt/ }).waitFor();
  await composer.press("Enter");
  await composer.locator("[data-mention]").waitFor();

  const shown = await openInstructionSources(page, locales[1]);
  await shown.order.getByText("Applies within features/forms/", { exact: true }).waitFor();
  assert.deepEqual(await shown.order.locator("[data-instruction-scope]").evaluateAll((rows) =>
    rows.map((row) => row.dataset.instructionScope)), ["features/forms", "features", "."]);
  assert.equal((await page.evaluate(() => window.pi.getSnapshot())).sessionId, null);
  await closeInstructionSources(page, shown);

  await composer.press("Enter");
  const first = await model.nextCompletion();
  const systemInstructions = (request) => request.input.messages
    .filter(({ role }) => role === "system" || role === "developer")
    .map(({ content }) => content).join("\n");
  assert.match(systemInstructions(first), /Fixture form guidance[\s\S]*Fixture parent guidance[\s\S]*Fixture root guidance/);
  assert.doesNotMatch(systemInstructions(first), /Fixture shadowed guidance|Fixture delivery guidance/);
  const running = await openInstructionSources(page, locales[1]);
  const target = "delivery/result.txt";
  sendTool(first, "discover-delivery", "write_file", { path: target, content: "Too early" });
  const review = await model.nextCompletion();
  assert.match(systemInstructions(review), /Fixture delivery guidance/);
  assert.match(review.input.messages.at(-1).content, /请按这些指令检查并重试文件操作/);
  assert.ok(!existsSync(join(project, target)));
  assert.equal(await page.locator("[data-permission-card]").count(), 0);
  await running.order.getByText("Applies within delivery/", { exact: true }).waitFor();
  await closeInstructionSources(page, running);

  sendTool(review, "write-to-delivery", "write_file", { path: target, content: "Reviewed" });
  await button(page.locator("[data-permission-card]"), "Allow once").press("Enter");
  const done = await model.nextCompletion();
  assert.equal(readFileSync(join(project, target), "utf8"), "Reviewed");
  done.write({ content: "The scoped instructions fixture is complete." });
  done.finish();
  await button(page, "Send").waitFor();
  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  assert.ok(snapshot.sessionId);
  return snapshot.sessionId;
}

export async function verifyInstructionSourceLayouts(page, window, sessionId) {
  await page.evaluate((id) => window.pi.sessionLoad(id), sessionId);
  let current = locales[1];
  let contrast = Infinity;
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const shown = await openInstructionSources(page, locale);
        await shown.order.locator('[data-instruction-scope="delivery"]').waitFor();
        await assertFits(shown.dialog);
        await assertFits(shown.order);
        await assertFits(shown.dialog.getByRole("heading", { name: locale.instructionSources }));
        await assertFits(button(shown.dialog, locale.close));
        contrast = Math.min(contrast, await minimumTextContrast(shown.dialog, "h2, p"));
        await closeInstructionSources(page, shown);
        console.log("Checked instruction sources at " + size.width + " × " + size.height + " " + locale.lang + " " + theme);
      }
    }
  }

  assert.ok(contrast >= 4.5, "Instruction source text must meet the contrast requirement");
  console.log("Instruction source text minimum contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, narrow, 1.5);
  const zoomed = await openInstructionSources(page, current);
  await zoomed.order.locator('[data-instruction-scope="delivery"]').waitFor();
  await assertFits(zoomed.dialog);
  await assertFits(zoomed.order);
  await zoomed.order.press("End");
  await page.waitForFunction(() => {
    const region = document.activeElement;
    return region?.matches('[role="region"]:focus-visible') && region.scrollTop > 0;
  });
  await closeInstructionSources(page, zoomed);
  await resize(page, window, wide);
}

export async function verifyWebTools(page, window, app, model) {
  const firstUrl = "https://docs.pilot.example/guide";
  const otherUrl = "https://other.pilot.example/latest";
  const searchQuery = "Pilot public web fixture";
  await app.evaluate(({ app, session, shell }, { firstUrl, otherUrl }) => {
    const requireApp = process.getBuiltinModule("node:module").createRequire(app.getAppPath() + "/package.json");
    const dns = process.getBuiltinModule("node:dns").promises;
    const { Readable } = process.getBuiltinModule("node:stream");
    const undici = requireApp("undici");
    const requests = [];
    const opened = [];
    globalThis.pilotWebTest = { requests, opened };
    const domains = ["docs.pilot.example", "other.pilot.example"];
    const oldLookup = dns.lookup;
    dns.lookup = (host, options) => domains.includes(host) && options?.all
      ? Promise.resolve([{ address: "93.184.215.14", family: 4 }])
      : oldLookup(host, options);
    const oldRequest = undici.request;
    undici.request = async (input, options) => {
      const host = options?.headers?.Host;
      if (!domains.includes(host)) return oldRequest(input, options);
      const url = new URL(String(input));
      requests.push({ host, path: url.pathname, query: url.searchParams.get("q") });
      if (url.pathname === "/redirect")
        return { statusCode: 302, headers: { location: otherUrl }, body: Readable.from([]) };
      const body = "<title>Pilot fixture guide</title><nav>fixture navigation</nav><main><p>Fixture body</p><p>" +
        "z".repeat(13_000) + "</p></main><script>fixture script</script>";
      return { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: Readable.from([Buffer.from(body)]) };
    };
    const browser = session.fromPartition("pilot-network", { cache: false });
    const oldFetch = browser.fetch.bind(browser);
    browser.fetch = async (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url ?? input.href);
      if (url.hostname !== "html.duckduckgo.com") return oldFetch(input, options);
      requests.push({ host: url.host, path: url.pathname, query: url.searchParams.get("q") });
      const body = '<div class="result"><a class="result__a" href="' + firstUrl +
        '">Pilot web fixture source</a><div class="result__snippet">A search snippet</div></div>';
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    };
    const oldOpen = shell.openExternal;
    shell.openExternal = async (url, options) => {
      if (url === firstUrl) opened.push(url);
      else return oldOpen(url, options);
    };
  }, { firstUrl, otherUrl });
  const receipts = () => app.evaluate(() => globalThis.pilotWebTest);
  await resize(page, window, wide);
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await send(page, "Find and read the public web fixture.");
  const initial = await model.nextCompletion();
  for (const name of ["web_search", "web_fetch"])
    assert.ok(initial.input.tools.some((tool) => tool.function.name === name));
  sendTool(initial, "fixture-search", "web_search", { query: searchQuery });
  const card = page.locator("[data-permission-card]");
  await card.locator("[data-permission-domain]").getByText("html.duckduckgo.com").waitFor();
  await card.locator("[data-permission-input]").getByText(searchQuery, { exact: true }).waitFor();
  assert.deepEqual((await receipts()).requests, []);

  let current = locales[1];
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme, "[data-permission-card]");
        current = locale;
        await assertFits(card.locator("[data-permission-domain]"));
        await assertFits(card.getByRole("button", { name: /^(Allow once|本次允许)$/ }));
      }
    }
  }
  await resize(page, window, narrow, 1.5);
  await assertFits(card.getByRole("button", { name: /^Allow once$/ }));
  await assertFits(card.getByRole("button", { name: /^More approval options$/ }));
  await card.focus();
  await page.keyboard.press("Enter");
  const results = await model.nextCompletion();
  assert.match(results.input.messages.at(-1).content, /Pilot web fixture source[\s\S]*A search snippet/);
  assert.ok(results.input.messages.at(-1).content.includes(firstUrl));
  assert.deepEqual((await receipts()).requests, [{
    host: "html.duckduckgo.com", path: "/html/", query: searchQuery,
  }]);

  await resize(page, window, wide);
  sendTool(results, "fixture-read", "web_fetch", { url: firstUrl });
  await card.locator("[data-permission-domain]").getByText("docs.pilot.example").waitFor();
  await card.locator("[data-permission-input]").getByText(firstUrl, { exact: true }).waitFor();
  await button(card, "More approval options").press("Enter");
  const grant = page.getByRole("menuitem", { name: /^Always allow Only docs\.pilot\.example$/ });
  await assertFits(grant);
  await grant.press("Enter");
  const read = await model.nextCompletion();
  const text = read.input.messages.at(-1).content;
  assert.match(text, /Fixture body[\s\S]*Page text truncated/);
  assert.doesNotMatch(text, /fixture navigation|fixture script|z{12001}/);
  const { toolRules } = await page.evaluate(() => window.pi.settingsGet());
  assert.ok(toolRules.some(({ toolName, domain }) => toolName === "web_fetch" && domain === "docs.pilot.example"));

  sendTool(read, "fixture-same-domain", "web_fetch", { url: new URL("/next", firstUrl).href });
  const allowed = await model.nextCompletion();
  assert.match(allowed.input.messages.at(-1).content, /Fixture body/);
  sendTool(allowed, "fixture-redirect", "web_fetch", { url: new URL("/redirect", firstUrl).href });
  const redirected = await model.nextCompletion();
  assert.ok(redirected.input.messages.at(-1).content.includes(otherUrl));
  assert.ok((await receipts()).requests.every(({ host }) => host !== "other.pilot.example"));
  sendTool(redirected, "fixture-other-domain", "web_fetch", { url: otherUrl });
  await card.locator("[data-permission-domain]").getByText("other.pilot.example").waitFor();
  await card.focus();
  await page.keyboard.press("Escape");
  const denied = await model.nextCompletion();
  assert.match(denied.input.messages.at(-1).content, /用户拒绝/);
  assert.ok((await receipts()).requests.every(({ host }) => host !== "other.pilot.example"));
  denied.write({ content: "The web source fixture is complete." });
  denied.finish();
  await page.getByText("The web source fixture is complete.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();

  await page.reload();
  await page.getByText("The web source fixture is complete.", { exact: true }).waitFor();
  const activity = page.locator("[data-reply-activity]").last();
  await button(activity, /^(Worked for|Steps taken:)/).press("Enter");
  await button(activity, new RegExp("^Search the web " + searchQuery)).press("Enter");
  const source = activity.getByRole("link", { name: "Pilot web fixture source", exact: true });
  await assertFits(source);
  assert.equal(await source.getAttribute("href"), firstUrl);
  await source.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-tool-sources] a") === document.activeElement);
  assert.deepEqual((await receipts()).opened, [firstUrl]);

  await openSettings(page, locales[1], "Permissions");
  const row = page.locator(".settings-row").filter({ hasText: "Only docs.pilot.example" });
  await row.getByText("Read web page", { exact: true }).waitFor();
  await button(row, "Revoke rule").press("Enter");
  await row.waitFor({ state: "hidden" });
  const revoked = await page.evaluate(() => window.pi.settingsGet());
  assert.ok(!revoked.toolRules?.some(({ domain }) => domain === "docs.pilot.example"));
}

function terminalRecords(page, composerId) {
  return page.evaluate((id) => window.pi.sessionTerminals(id), composerId);
}

function terminalOutput(page, record) {
  return page.evaluate(
    ({ composerId, id }) => window.pi.sessionTerminalOutput(composerId, id),
    { composerId: record.composerId, id: record.id },
  );
}

function terminalStatus(page, status) {
  return page.locator('[data-terminal-panel] [data-terminal-status="' + status + '"]');
}

async function assertTerminalFits(page) {
  const screen = page.locator("[data-terminal-screen]");
  await screen.waitFor();
  await page.waitForFunction(() => {
    const viewport = document.querySelector("[data-terminal-screen] .xterm-screen");
    const wrapper = viewport?.closest("[data-terminal-screen]");
    if (!viewport || !wrapper) return false;
    const bounds = viewport.getBoundingClientRect();
    const region = wrapper.getBoundingClientRect();
    return bounds.width > 0 && bounds.right <= region.right && bounds.bottom <= region.bottom;
  });
  await assertFits(screen);
}

async function waitForTerminalOutput(page, record, pattern) {
  const until = Date.now() + 12_000;
  let text;
  do {
    text = stripVTControlCharacters((await terminalOutput(page, record)).data);
    if (pattern.test(text)) return text;
    await delay(100);
  } while (Date.now() < until);
  assert.match(text, pattern);
}

async function typeTerminal(page, command) {
  const field = page.locator("[data-terminal-screen] .xterm-helper-textarea");
  await field.focus();
  await page.keyboard.type(command);
  await field.press("Enter");
}

async function chooseCommandShell(page, shell) {
  await openSettings(page, locales[1], "General");
  const environment = page.locator('[aria-labelledby="settings-workspace"]');
  const control = environment.locator("#command-shell");
  const selected = await control.innerText();
  if (selected !== shell) {
    await control.click();
    await page.getByRole("option", { name: shell, exact: true }).click();
    const save = button(environment, "Save");
    await save.click();
    await environment.getByText("Saved", { exact: true }).waitFor();
  }
  await page.keyboard.press("Control+l");
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
}

export async function verifyInteractiveTerminal(page, window, app, project) {
  await resize(page, window, wide);
  await chooseCommandShell(page, "PowerShell");
  await page.evaluate((directory) => window.pi.sessionUseRecentProject(directory), project);
  await waitForProjectDraft(page, project);
  await button(page.getByRole("main"), basename(project)).waitFor();
  const initial = await page.evaluate(() => window.pi.getSnapshot());
  await editor(page).focus();
  await page.keyboard.press("Control+Backquote");
  const tab = page.getByRole("tab", { name: "Terminal", selected: true });
  await tab.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab");
  assert.deepEqual(await terminalRecords(page, initial.composerId), []);
  const open = button(page.locator("[data-terminal-panel]"), "Open terminal");
  await open.press("Enter");
  await terminalStatus(page, "running").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Terminal input");
  const [powershell] = await terminalRecords(page, initial.composerId);
  assert.equal(powershell.shell, "powershell");
  assert.equal(powershell.workingDirectory, project);
  const draft = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(draft.sessionId, null);
  assert.equal(draft.composerId, initial.composerId);
  assert.equal(draft.sessions.length, initial.sessions.length);

  await waitForTerminalOutput(page, powershell, /PS .*>/);
  await typeTerminal(page, "('PS-' + 'DIR=') + (Split-Path -Leaf (Get-Location).Path)");
  await waitForTerminalOutput(page, powershell, new RegExp("PS-DIR=" + basename(project)));
  await typeTerminal(page, "('PILOT-' + 'INT'); Start-Sleep -Seconds 120");
  await waitForTerminalOutput(page, powershell, /PILOT-INT/);
  await page.keyboard.press("Control+c");
  await waitForTerminalOutput(page, powershell, /PILOT-INT[\s\S]*PS .*>/);
  await button(page.locator("[data-terminal-panel]"), "Copy output").press("Enter");
  await page.getByText("Output copied", { exact: true }).waitFor();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(copied, new RegExp("PS-DIR=" + basename(project)));

  await page.locator("[data-terminal-screen] .xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Backquote");
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));

  let current = locales[1];
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await page.keyboard.press("Control+Backquote");
        const panel = page.locator("[data-terminal-panel]");
        await assertTerminalFits(page);
        for (const control of await panel.getByRole("button").all()) await assertFits(control);
        await assertFits(page.getByRole("tab", { name: locale.tabs[3], selected: true }));
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
      }
    }
  }

  await resize(page, window, narrow, 1.5);
  await page.keyboard.press("Control+Backquote");
  await assertTerminalFits(page);
  await assertFits(button(page.locator("[data-terminal-panel]"), "Stop terminal"));
  await page.keyboard.press("Escape");
  await resize(page, window, wide);
  await choosePalette(page, "review-terminal", /^Open the Terminal tab/);
  await terminalStatus(page, "running").waitFor();
  await button(page.locator("[data-terminal-panel]"), "Stop terminal").press("Enter");
  await terminalStatus(page, "stopped").waitFor();
  await page.getByRole("tab", { name: "Terminal", selected: true }).press("Escape");

  await chooseCommandShell(page, "Git Bash");
  await page.keyboard.press("Control+Backquote");
  await button(page.locator("[data-terminal-panel]"), "Open terminal").press("Enter");
  await terminalStatus(page, "running").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Terminal input");
  const bash = (await terminalRecords(page, initial.composerId)).at(-1);
  assert.equal(bash.shell, "bash");
  await waitForTerminalOutput(page, bash, /bash[^$]*\$/);
  await typeTerminal(page, "printf 'BASH-%s\\n' \"$(basename \"$PWD\")\"");
  await waitForTerminalOutput(page, bash, new RegExp("BASH-" + basename(project)));
  await typeTerminal(page, "exit 7");
  await terminalStatus(page, "failed").waitFor();
  await page.getByRole("alert").getByText(/exited with code 7/).waitFor();
  await page.getByRole("tab", { name: "Terminal", selected: true }).press("Escape");
  await chooseCommandShell(page, "PowerShell");
}

export async function verifyBackgroundTerminal(page, model, project) {
  const initial = await page.evaluate(() => window.pi.getSnapshot());
  await send(page, "Start a background fixture command and report its result.");
  const first = await model.nextCompletion();
  for (const name of ["bash", "read_background_command", "stop_background_command"])
    assert.ok(first.input.tools.some((tool) => tool.function.name === name));
  const command = "Write-Output 'fixture-background-ready'; Start-Sleep -Seconds 120";
  sendTool(first, "start-job", "bash", { command, background: true });
  const approval = page.locator("[data-permission-card]");
  await approval.getByText(command, { exact: true }).waitFor();
  const records = await terminalRecords(page, initial.composerId);
  assert.equal(records.filter(({ source }) => source === "agent").length, 0);
  assert.ok(records.some(({ source, shell }) => source === "user" && shell === "powershell"));
  const promoted = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(promoted.sessionId, initial.composerId, "Sending promotes the existing terminal's draft");
  await button(approval, "Allow once").click();
  const started = await model.nextCompletion();
  const [job] = (await terminalRecords(page, initial.composerId)).filter(({ source }) => source === "agent");
  assert.match(started.input.messages.at(-1).content, new RegExp(job.id));
  assert.equal(job.workingDirectory, project);

  await page.keyboard.press("Control+Backquote");
  const chooser = button(page.locator("[data-terminal-panel]"), "Choose a terminal or background command");
  await chooser.press("Enter");
  await page.getByRole("menuitem", { name: /fixture-background-ready/ }).press("Enter");
  await terminalStatus(page, "running").waitFor();
  await page.locator("[data-terminal-screen] [role=listitem]").filter({ hasText: /^fixture-background-ready$/ }).waitFor();
  sendTool(started, "read-job", "read_background_command", { id: job.id });
  const read = await model.nextCompletion();
  assert.match(read.input.messages.at(-1).content, /running[\s\S]*fixture-background-ready/);
  sendTool(read, "stop-job", "stop_background_command", { id: job.id });
  const stopped = await model.nextCompletion();
  assert.match(stopped.input.messages.at(-1).content, /has ended/);
  await terminalStatus(page, "stopped").waitFor();
  await page.getByRole("tab", { name: "Terminal", selected: true }).press("Escape");

  const tree = "node -e 'console.log(process.pid); setInterval(()=>{}, 1000)'";
  sendTool(stopped, "start-job-tree", "bash", { command: tree, background: true });
  await approval.getByText(tree, { exact: true }).waitFor();
  await button(approval, "Allow once").click();
  const last = await model.nextCompletion();
  const automatic = (await terminalRecords(page, initial.composerId)).at(-1);
  const pid = Number((await waitForTerminalOutput(page, automatic, /\b\d+\r?\n/)).trim());
  assert.ok(Number.isInteger(pid) && pid > 0);
  process.kill(pid, 0);
  last.write({ content: "The background command fixture is complete." });
  last.finish();
  await page.getByText("The background command fixture is complete.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  const finished = await terminalRecords(page, initial.composerId);
  assert.equal(finished.find(({ id }) => id === automatic.id).status, "stopped");
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

export async function prepareTerminalExit(page, app) {
  await editor(page).focus();
  await page.keyboard.press("Control+Backquote");
  await button(page.locator("[data-terminal-panel]"), "Open terminal").press("Enter");
  await terminalStatus(page, "running").waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Terminal input");
  const { composerId } = await page.evaluate(() => window.pi.getSnapshot());
  const shell = (await terminalRecords(page, composerId)).at(-1);
  await waitForTerminalOutput(page, shell, /PS .*>/);
  await typeTerminal(page, "('PILOT-' + 'SHELL-PID=') + $PID");
  const text = await waitForTerminalOutput(page, shell, /PILOT-SHELL-PID=\d+/);
  const pid = Number(/PILOT-SHELL-PID=(\d+)/.exec(text)[1]);
  process.kill(pid, 0);
  await app.evaluate(({ dialog }) => {
    dialog.pilotTerminalExitRequests = 0;
    dialog.showMessageBox = async (_window, options) => {
      if (!options.detail?.includes("A terminal or background command is running."))
        throw new Error("The exit confirmation did not mention the active terminal");
      return { response: dialog.pilotTerminalExitRequests++, checkboxChecked: false };
    };
  });
  await page.evaluate(() => window.pi.menuAction("quit"));
  assert.equal(await app.evaluate(({ dialog }) => dialog.pilotTerminalExitRequests), 1);
  assert.equal((await terminalRecords(page, composerId)).at(-1).status, "running");
  return pid;
}

function minimumTextContrast(container, selector) {
  return container.evaluate((element, textSelector) => {
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const luminance = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgb = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
      return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
        const value = rgb[index] / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return total + weight * linear;
      }, 0);
    };
    let surface = element;
    while (getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)" && surface.parentElement)
      surface = surface.parentElement;
    const background = luminance(getComputedStyle(surface).backgroundColor);
    const ratios = Array.from(element.querySelectorAll(textSelector), (text) => {
      const foreground = luminance(getComputedStyle(text).color);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    if (!ratios.length) throw new Error("There is no text to measure");
    return Math.min(...ratios);
  }, selector);
}

async function verifyPlanLayout(card, locale) {
  await assertFits(card.getByRole("heading", { name: locale.plan }));
  for (const name of [locale.discardPlan, locale.editPlan, locale.executePlan])
    await assertFits(button(card, name));
  const contrast = await minimumTextContrast(card, "h2");
  assert.ok(contrast >= 4.5, "The plan status must meet text contrast requirements");
  return contrast;
}

export async function verifyPlanDraft(page, window, model, project) {
  await page.keyboard.press("Control+n");
  await page.keyboard.press("Control+l");
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
  for (const mode of ["Read-only", "Full access", "Ask first"]) {
    await page.keyboard.press("Shift+Tab");
    await button(page, mode).waitFor();
  }
  const planningMode = page.locator("[data-plan-mode]");
  await planningMode.waitFor({ state: "hidden" });
  await button(page, "Ask first").press("Enter");
  const menu = page.getByRole("menu");
  await menu.waitFor();
  assert.equal(await menu.getByRole("menuitem", { name: /^Plan mode/ }).count(), 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Ask first");

  const planCommand = page.getByRole("option", { name: /^Plan mode/ });
  await editor(page).fill("Keep this /plan draft.");
  await editor(page).evaluate((field) => {
    const caret = document.createRange();
    caret.setStart(field.firstChild, "Keep this /plan".length);
    caret.collapse(true);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(caret);
  });
  await assertFits(planCommand);
  await page.keyboard.press("Enter");
  await planningMode.waitFor();
  assert.equal((await editor(page).innerText()).replace(/\s+/g, " "), "Keep this draft.");
  await button(page, "Ask first").waitFor();
  for (const mode of ["Read-only", "Full access", "Ask first"]) {
    await page.keyboard.press("Shift+Tab");
    await button(page, mode).waitFor();
    await planningMode.waitFor();
  }
  await editor(page).fill("/plan");
  await planCommand.getByText("Exit Plan mode.").waitFor();
  await page.keyboard.press("Enter");
  await planningMode.waitFor({ state: "hidden" });
  await button(page, "Ask first").waitFor();

  await resize(page, window, narrow);
  await selectAppearance(page, locales[1], locales[0], "light");
  await editor(page).fill("/plan");
  const chinesePlanCommand = page.getByRole("option", { name: /^计划模式/ });
  await assertFits(chinesePlanCommand);
  await chinesePlanCommand.click();
  await assertFits(planningMode);
  await button(page, "确认模式").waitFor();
  await resize(page, window, wide);
  await selectAppearance(page, locales[0], locales[1], "dark");
  await send(page, planPrompt);
  const research = await model.nextCompletion();
  assert.deepEqual(research.input.tools.map((tool) => tool.function.name), [
    "read_file",
    "glob",
    "grep",
    "update_plan",
    "propose_plan",
    "run_subtask",
  ]);
  await editor(page).fill(planningDraft);
  sendTool(research, "fixture-plan-read", "read_file", { path: approvedFile });
  const proposal = await model.nextCompletion();
  assert.match(proposal.input.messages.at(-1).content, /Approved in the desktop scene/);
  sendTool(proposal, "fixture-plan-proposal", "propose_plan", {
    markdown: "1. Write the fixture note.\n2. Verify the file.",
  });
  const planning = await model.nextCompletion();
  planning.write({ content: "The plan is ready." });
  planning.finish();

  const target = "[data-plan-review]";
  const card = page.locator(target);
  await card.waitFor();
  await editor(page).waitFor({ state: "hidden" });
  await page.waitForFunction((selector) => document.activeElement?.matches(selector), target);
  assert.ok(!existsSync(join(project, plannedFile)));

  let current = locales[1];
  let minContrast = Infinity;
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme, target);
        current = locale;
        minContrast = Math.min(minContrast, await verifyPlanLayout(card, locale));
        console.log(`Checked plan review at ${size.width} × ${size.height} ${locale.lang} ${theme}`);
      }
    }
  }
  console.log("Plan status text minimum contrast " + minContrast.toFixed(2) + ":1");
  await resize(page, window, narrow, 1.5);
  await verifyPlanLayout(card, current);
  const edit = button(card, current.editPlan);
  await edit.press("Enter");
  const field = card.getByRole("textbox", { name: "Plan contents" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-plan-review] textarea"));
  await field.press("Escape");
  await page.waitForFunction(
    (name) => document.activeElement?.textContent?.trim() === name,
    current.editPlan,
  );
  await page.keyboard.press("Enter");
  await field.fill(revisedPlan);
  await button(card, "Save plan").press("Enter");
  await card.getByText("Write the revised fixture note.", { exact: true }).waitFor();
  await page.waitForFunction(
    (name) => document.activeElement?.textContent?.trim() === name,
    current.editPlan,
  );
  await resize(page, window, wide);
}

export async function verifyPlanExecution(page, model, project) {
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search" }).getByRole("textbox", { name: "Search" });
  await search.fill(planPrompt.slice(0, 20));
  await search.press("Enter");
  const card = page.locator("[data-plan-review]");
  await card.getByText("Write the revised fixture note.", { exact: true }).waitFor();
  await card.getByText("Confirm to execute this plan in Ask first mode.", { exact: true }).waitFor();
  assert.ok(!existsSync(join(project, plannedFile)));
  await page.keyboard.press("Control+l");
  await page.waitForFunction(() => document.activeElement?.matches("[data-plan-review]"));
  const execute = button(card, "Confirm and execute");
  const focusStops = [];
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    if (await execute.evaluate((element) => element === document.activeElement)) break;
    focusStops.push(await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 60)));
  }
  assert.ok(
    await execute.evaluate((element) => element === document.activeElement),
    "Plan confirmation must be reachable with Tab. Focus reached: " + focusStops.join(", "),
  );
  await page.keyboard.press("Enter");
  const implementation = await model.nextCompletion();
  assert.match(implementation.input.messages.at(-1).content, /Write the revised fixture note/);
  assert.match(implementation.input.messages.at(-1).content, /The user approved the plan/);
  assert.ok(implementation.input.tools.some((tool) => tool.function.name === "write_file"));
  sendTool(implementation, "fixture-plan-write", "write_file", {
    path: plannedFile,
    content: "Revised plan implemented.\n",
  });
  const permission = page.locator("[data-permission-card]");
  await permission.getByText(join(project, plannedFile), { exact: true }).waitFor();
  assert.ok(!existsSync(join(project, plannedFile)), "Plan confirmation keeps tool approvals in effect");
  await page.waitForFunction(() => document.activeElement?.matches("[data-permission-card]"));
  await page.keyboard.press("Enter");
  const done = await model.nextCompletion();
  assert.equal(readFileSync(join(project, plannedFile), "utf8"), "Revised plan implemented.\n");
  done.write({ content: "The revised plan is implemented." });
  done.finish();
  await page.getByText("The revised plan is implemented.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  assert.equal(await editor(page).innerText(), planningDraft);
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
  await button(page, "Ask first").waitFor();
}

export async function verifyRestoredSettings(page, model) {
  await page.waitForFunction(
    () =>
      document.documentElement.lang === "en" && document.documentElement.classList.contains("dark"),
  );
  const { settings } = await page.evaluate(() => window.pi.getSnapshot());
  const active = settings.providers.find(({ id }) => id === settings.activeProviderId);
  assert.equal(active?.baseUrl, model.baseUrl);
  assert.equal(active?.modelId, model.modelId);
  await openSettings(page, locales[1], "General");
  await page.getByRole("switch", { name: "Desktop notifications", checked: false }).waitFor();
  await openSettings(page, locales[1], "Personalization");
  assert.equal(
    await page.getByRole("textbox", { name: "Custom instructions", exact: true }).inputValue(),
    instructions,
  );
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  await palette.getByRole("textbox", { name: "Search" }).fill(streamPrompt);
  await palette.getByRole("textbox", { name: "Search" }).press("Enter");
  await page.getByText(approvalReply, { exact: true }).waitFor();
  assert.equal(await editor(page).innerText(), draft);
}

export async function verifySearchAndExport(page, app, model, project) {
  const activeChat = page.locator('[data-session-id][aria-current="page"]');
  const sessionId = await activeChat.getAttribute("data-session-id");
  assert.ok(sessionId, "The stream fixture must be the active chat");
  await send(page, "Prepare the search and Markdown export fixture.");
  const reply = await model.nextCompletion();
  sendTool(reply, "fixture-search-shell", "bash", { command: shellSearch });
  const approval = page.locator("[data-permission-card]");
  await approval.getByText(shellSearch, { exact: true }).waitFor();
  await button(approval, "Allow once").click();
  const result = await model.nextCompletion();
  assert.match(result.input.messages.at(-1).content, /PilotFindCommand/);
  result.write({ content: "**Search fixture** uses jump needle twice.\n\nThe second jump needle is here." });
  result.finish();
  await button(page, "Send").waitFor();

  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+f");
  const find = page.locator("[data-chat-find-input]");
  await find.fill("jump needle");
  const count = page.locator("[data-chat-find-count]");
  await count.getByText("1 / 2", { exact: true }).waitFor();
  await page.waitForFunction(() => CSS.highlights?.has("pilot-chat-find"));
  await find.press("Enter");
  await count.getByText("2 / 2", { exact: true }).waitFor();
  await find.press("Shift+Enter");
  await count.getByText("1 / 2", { exact: true }).waitFor();
  await find.press("Escape");
  await find.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));

  await page
    .locator("[data-session-id]")
    .getByText(planPrompt.slice(0, 24), { exact: true })
    .click();
  await page.locator("[data-plan-review]").waitFor();
  assert.notEqual(await activeChat.getAttribute("data-session-id"), sessionId);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  const search = palette.getByRole("textbox", { name: "Search" });
  const scope = palette.getByRole("combobox", { name: "Search project scope" });
  await search.fill(shellSearch);
  await scope.click();
  await page.getByRole("option", { name: "No linked project", exact: true }).click();
  await palette.getByText("No matching results", { exact: true }).waitFor();
  await scope.click();
  await page.getByRole("option", { name: new RegExp("^" + basename(project)) }).click();
  const hit = palette.locator(`[data-session-search-hit="${sessionId}"]`).first();
  await hit.getByText(shellSearch, { exact: true }).waitFor();
  await search.press("Enter");
  await find.waitFor();
  assert.equal(await activeChat.getAttribute("data-session-id"), sessionId);
  assert.equal(await find.inputValue(), shellSearch);
  const foundPart = page.locator("main [data-chat-find-current]");
  await foundPart.getByText("PilotFindCommand", { exact: true }).waitFor();
  assert.equal(await foundPart.locator("[data-tool-state=success]").count(), 1);
  await find.press("Escape");

  await page.keyboard.press("Control+k");
  await search.fill("APPROVED.TXT");
  await hit.click();
  await find.waitFor();
  assert.equal(await activeChat.getAttribute("data-session-id"), sessionId);
  assert.equal(await find.inputValue(), "APPROVED.TXT");
  await page.locator("[data-chat-find-snippet] mark").getByText(approvedFile, { exact: true }).waitFor();
  await find.press("Escape");

  const destination = join(project, "exported-chat.md");
  const exportItem = async (cancel) => {
    await app.evaluate(({ dialog }, options) => {
      const original = dialog.showSaveDialog;
      dialog.showSaveDialog = async (_window, config) => {
        dialog.showSaveDialog = original;
        if (config.title !== "Export Markdown" || !config.defaultPath.endsWith(".md"))
          throw new Error("Expected a Markdown save dialog");
        return { canceled: options.cancel, filePath: options.cancel ? "" : options.path };
      };
    }, { path: destination, cancel });
    await button(page.locator("main"), "More actions").click();
    await page.getByRole("menuitem", { name: "Export Markdown…", exact: true }).click();
  };
  await exportItem(true);
  assert.ok(!existsSync(destination));
  await exportItem(false);
  await page.getByText("Chat exported", { exact: true }).waitFor();
  await page.getByRole("menuitem", { name: "Export Markdown…", exact: true }).waitFor({ state: "hidden" });
  await button(page.locator("main"), "More actions").focus();
  const markdown = readFileSync(destination, "utf8");
  for (const value of ["# Desktop stream scene", "## User", "## Assistant", "**Search fixture**", shellSearch, approvedFile])
    assert.ok(markdown.includes(value), "Markdown must include " + value);
}

async function choosePalette(page, query, name, category = /^(All|全部)$/) {
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: /^(Search|搜索)$/ });
  await button(palette, category).click();
  const search = palette.getByRole("textbox");
  await search.fill(query);
  await palette.getByRole("option", { name, selected: true }).waitFor();
  await search.press("Enter");
  await palette.waitFor({ state: "hidden" });
}

async function chooseSlash(page, command) {
  const composer = editor(page);
  await composer.fill(command);
  await composer.press("End");
  await page
    .getByRole("option", { selected: true })
    .getByText(command, { exact: true })
    .waitFor();
  await composer.press("Enter");
}

async function waitForProjectDraft(page, directory) {
  await page.waitForFunction(async (project) => {
    const snapshot = await window.pi.getSnapshot();
    return !snapshot.sessionId && snapshot.draftWorkingDirectory === project;
  }, directory);
}

export async function verifySubtasks(page, window, model, project) {
  const snapshot = () => page.evaluate(() => window.pi.getSnapshot());
  const tokenUsage = (input, output) => ({
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input + output,
  });
  const toolNames = ({ input }) => input.tools.map(({ function: tool }) => tool.name);
  const question = "What does notes.txt say?";
  const evidence = "Private trace fixture details.";
  const conclusion = "The workspace note describes the fixture.";
  const answer = "The project research is complete.";
  const success = page.locator("[data-subtask-status=success]");
  const trigger = (line) => page.locator("[data-slot=trace-collapsible-trigger]").filter({ has: line });
  const activity = page.locator(
    "[data-reply-activity] > [data-slot=trace-collapsible] > [data-slot=trace-collapsible-trigger]",
  );
  const subtask = trigger(success);
  const trace = page.locator("[data-subtask-trace]");
  const waitForUsage = (input, output, contextTokens) => page.waitForFunction(
    async ({ input, output, contextTokens }) => {
      const { usage, contextTokens: context } = await window.pi.getSnapshot();
      return usage.input === input && usage.output === output && context === contextTokens;
    },
    { input, output, contextTokens },
  );
  writeFileSync(join(project, "notes.txt"), evidence + "\n");
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "subtask-model", kind: "openai-compatible", name: "Subtask fixture",
        baseUrl, modelId, models: [{ id: modelId, name: "Subtask test model" }] }],
      activeProviderId: "subtask-model",
    });
    await window.pi.settingsSetNotificationsEnabled(false);
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await waitForProjectDraft(page, project);

  await send(page, "Delegate research on the workspace note.");
  const parent = await model.nextCompletion();
  assert.ok(toolNames(parent).includes("run_subtask"));
  sendTool(parent, "fixture-subtask", "run_subtask", { question }, tokenUsage(11, 3));
  const child = await model.nextCompletion();
  assert.equal(child.input.model, parent.input.model);
  assert.deepEqual(toolNames(child), ["read_file", "glob", "grep"]);
  assert.deepEqual(child.input.messages.filter(({ role }) => role === "user").map(({ content }) => content),
    [[{ type: "text", text: question }]]);
  await page.locator("[data-subtask-status=running][data-status=running]").getByText(question, { exact: false }).waitFor();
  sendTool(child, "fixture-subtask-read", "read_file", { path: "notes.txt" }, tokenUsage(17, 5));
  const childReply = await model.nextCompletion();
  assert.ok(childReply.input.messages.at(-1).content.includes(evidence));
  await trace.getByRole("group", { name: "子任务步骤" }).getByText("读取文件 notes.txt").waitFor();
  await trace.getByText("子任务用量 22 token", { exact: true }).waitFor();
  await waitForUsage(28, 8, 14);
  const sessionId = (await snapshot()).sessionId;
  assert.ok(sessionId);
  await page.reload();
  await trace.getByText("子任务用量 22 token", { exact: true }).waitFor();
  assert.equal((await snapshot()).sessionId, sessionId);

  childReply.write({ content: conclusion });
  childReply.finish("stop", tokenUsage(31, 7));
  const parentReply = await model.nextCompletion();
  assert.equal(parentReply.input.messages.at(-1).content, conclusion);
  assert.ok(!JSON.stringify(parentReply.input.messages).includes(evidence));
  parentReply.write({ content: answer });
  parentReply.finish("stop", tokenUsage(12, 4));
  await page.getByText(answer, { exact: true }).waitFor();
  await waitForIdle(page);
  await waitForUsage(71, 19, 16);
  await activity.and(page.locator('[aria-expanded="false"]')).waitFor();

  let current = locales[0];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const english = locale.lang === "en";
        await activity.press("Enter");
        await subtask.and(page.locator('[aria-expanded="false"]')).waitFor();
        assert.match(await subtask.innerText(), english ? /Subtask/ : /子任务/);
        await page.keyboard.press("Tab");
        await subtask.and(page.locator(":focus-visible")).waitFor();
        await assertFits(subtask);
        await page.keyboard.press("Space");
        await trace.getByText(english ? "Subtask usage 60 tokens" : "子任务用量 60 token", { exact: true }).waitFor();
        await page.getByText(conclusion, { exact: true }).waitFor();
        const read = button(trace.getByRole("group", { name: english ? "Subtask steps" : "子任务步骤" }),
          english ? "Read file notes.txt" : "读取文件 notes.txt");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await read.and(page.locator(":focus-visible")).waitFor();
        await assertFits(read);
        await page.keyboard.press("Enter");
        await trace.getByText(evidence, { exact: true }).waitFor();
        contrast = Math.min(contrast, await minimumTextContrast(trace, "[data-slot=trace-title], [data-subtask-usage]"));
        await page.keyboard.press("Enter");
        await read.and(page.locator(':focus-visible[aria-expanded="false"]')).waitFor();
        await subtask.press("Space");
        await subtask.and(page.locator(':focus-visible[aria-expanded="false"]')).waitFor();
        await activity.press("Enter");
        await activity.and(page.locator(':focus-visible[aria-expanded="false"]')).waitFor();
      }
    }
  }
  assert.ok(contrast >= 4.5, "Subtask trace contrast " + contrast.toFixed(2) + ":1");
  console.log("Subtask trace minimum contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, wide);

  await chooseSlash(page, "/plan");
  await send(page, "Start a second research task in Plan mode.");
  const planning = await model.nextCompletion();
  assert.ok(toolNames(planning).includes("run_subtask"));
  assert.ok(!toolNames(planning).includes("write_file"));
  sendTool(planning, "fixture-stopped-subtask", "run_subtask", { question: "Recheck notes.txt." });
  const pending = await model.nextCompletion();
  const running = page.locator("[data-subtask-status=running]");
  await running.waitFor();
  await button(page, "Stop").press("Enter");
  await pending.waitForClose();
  const stopped = page.locator("[data-subtask-status=stopped]");
  const stoppedMessage = "The subtask stopped. You can delegate it again in the next turn.";
  await stopped.getByText(/Stopped Subtask Recheck notes.txt/).waitFor();
  await page.getByText(stoppedMessage, { exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);
  await page.reload();
  assert.equal((await snapshot()).sessionId, sessionId);
  assert.deepEqual((await snapshot()).usage, {
    input: 71, output: 19, cacheRead: 0, cacheWrite: 0, costTotal: 0,
  });
  await stopped.waitFor();
  await page.getByText(stoppedMessage, { exact: true }).waitFor();
  await activity.press("Enter");
  await subtask.press("Enter");
  await trace.getByText("Subtask usage 60 tokens", { exact: true }).waitFor();
  await button(trace, "Read file notes.txt").press("Enter");
  await trace.getByText(evidence, { exact: true }).waitFor();
  assert.equal(readFileSync(join(project, "notes.txt"), "utf8"), evidence + "\n");
}

export async function verifyGitWorktrees(page, window, model, project) {
  const snapshot = () => page.evaluate(() => window.pi.getSnapshot());
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "worktree-model", kind: "openai-compatible", name: "Worktree fixture",
        baseUrl, modelId, models: [{ id: modelId, name: "Worktree test model" }] }],
      activeProviderId: "worktree-model",
    });
    await window.pi.settingsSetNotificationsEnabled(false);
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await waitForProjectDraft(page, project);
  const dialog = page.locator("[data-worktree-dialog]");
  const card = page.locator("[data-permission-card]");
  const show = async (locale = locales[1]) => {
    const trigger = button(page, locale.lang === "en" ? "Worktrees…" : "工作树…");
    if (!(await trigger.isVisible())) await page.keyboard.press("Control+Shift+d");
    await trigger.click();
    await dialog.getByRole("combobox", { name: locale.lang === "en" ? "Base branch" : "基准分支" })
      .getByText("main", { exact: true }).waitFor();
    return trigger;
  };
  let current = locales[0];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const trigger = await show(locale);
        await assertFits(dialog);
        await assertFits(button(dialog, locale.lang === "en" ? "Create worktree" : "创建工作树"));
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, p, label"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus")).waitFor();
      }
    }
  }
  assert.ok(contrast >= 4.5, "Worktree dialog contrast " + contrast.toFixed(2) + ":1");
  console.log("Worktree dialog minimum contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, wide);

  const create = async (branch) => {
    await show();
    await dialog.getByRole("textbox", { name: "Task branch name", exact: true }).fill(branch);
    await button(dialog, "Create worktree").press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await editor(page).and(page.locator(":focus")).waitFor();
    const state = await snapshot();
    assert.equal(state.sessionId, null);
    assert.equal(state.worktree.projectDirectory, project);
    assert.equal(state.worktree.branch, branch);
    assert.equal(state.worktree.baseBranch, "main");
    return state.worktree;
  };
  const first = await create("codex/desktop-one");
  await send(page, "First worktree change");
  sendTool(await model.nextCompletion(), "worktree-a", "write_file", {
    path: "result.txt", content: "First worktree",
  });
  await card.waitFor();
  const a = (await snapshot()).sessionId;
  const second = await create("codex/desktop-two");
  assert.notEqual(first.directory, second.directory);
  await send(page, "Second worktree change");
  sendTool(await model.nextCompletion(), "worktree-b", "write_file", {
    path: "result.txt", content: "Second worktree",
  });
  await card.waitFor();
  const b = (await snapshot()).sessionId;
  const runs = (await snapshot()).activeRuns;
  assert.deepEqual(runs.map(({ workingDirectory, status }) => [workingDirectory, status]), [
    [first.directory, "waiting_approval"], [second.directory, "waiting_approval"],
  ]);
  const approve = async (reply) => {
    await button(card, "Allow once").press("Enter");
    const completion = await model.nextCompletion();
    completion.write({ content: reply });
    completion.finish();
    await page.getByText(reply, { exact: true }).waitFor();
    await page.waitForFunction(async () => (await window.pi.getSnapshot()).status === "idle");
  };
  await approve("Second worktree complete.");
  await page.locator('[data-session-id="' + a + '"]').click();
  await approve("First worktree complete.");
  assert.equal(readFileSync(join(first.directory, "result.txt"), "utf8"), "First worktree");
  assert.equal(readFileSync(join(second.directory, "result.txt"), "utf8"), "Second worktree");
  assert.ok(!existsSync(join(project, "result.txt")));
  assert.deepEqual((await snapshot()).recentProjects, [project]);

  execFileSync("git", ["add", "result.txt"], { cwd: second.directory });
  execFileSync("git", ["-c", "commit.gpgSign=false", "commit", "-qm", "Second worktree result"], { cwd: second.directory });
  await show();
  const review = (branch) => button(dialog.getByRole("listitem").filter({ hasText: branch }), "Review worktree…");
  await review(second.branch).press("Enter");
  await dialog.locator("pre").getByText(/\+Second worktree/).waitFor();
  await button(dialog, "Merge into main").press("Enter");
  await dialog.getByRole("status").filter({ hasText: "Task branch merged." }).waitFor();
  assert.equal(readFileSync(join(project, "result.txt"), "utf8"), "Second worktree");
  await dialog.getByRole("button", { name: "Close", exact: true, disabled: false }).press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  const row = page.locator('[data-session-id="' + a + '"]');
  await row.hover();
  await button(row.locator(".."), "Archive chat").click();
  const archive = page.locator("[data-worktree-archive]");
  await archive.getByText("result.txt", { exact: true }).waitFor();
  await assertFits(archive);
  await button(archive, "Archive chat").press("Enter");
  await archive.waitFor({ state: "hidden" });
  assert.equal((await snapshot()).sessions.find(({ id }) => id === a).archived, true);
  assert.ok(existsSync(first.directory));

  await page.evaluate((directory) => window.pi.sessionUseRecentProject(directory), project);
  await waitForProjectDraft(page, project);
  await show();
  await review(first.branch).press("Enter");
  await dialog.getByText("result.txt", { exact: true }).waitFor();
  await button(dialog, "Discard changes and remove").press("Enter");
  await dialog.getByRole("status").filter({ hasText: "Worktree removed." }).waitFor();
  assert.equal((await snapshot()).sessions.find((item) => item.id === a)?.worktree?.removed, true);
  assert.ok(!existsSync(first.directory));
  assert.ok(existsSync(second.directory));
  assert.equal((await snapshot()).sessions.find(({ id }) => id === b).worktree.branch, second.branch);
  assert.equal(execFileSync("git", ["rev-parse", first.branch], { cwd: project, encoding: "utf8" }).trim(),
    first.baseCommit);
  await dialog.getByRole("button", { name: "Close", exact: true, disabled: false }).press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await page.reload();
  await waitForProjectDraft(page, project);
  await editor(page).waitFor();
  await show();
  await button(dialog.getByRole("listitem").filter({ hasText: second.branch }), "Open chat").press("Enter");
  await page.getByText("Second worktree complete.", { exact: true }).waitFor();
  assert.equal((await snapshot()).sessionId, b);
}

export async function verifyParallelSessions(page, window, app, model, projects, scratch) {
  const [projectA, projectB, projectC] = projects;
  const script = join(scratch, "parallel-mcp.cjs");
  const output = "parallel-result.txt";
  const description = "Read the current project directory";
  writeFileSync(script, [
    'const { writeFileSync } = require("node:fs");',
    'const { basename, join } = require("node:path");',
    'const directory = process.cwd();',
    'writeFileSync(join(__dirname, basename(directory) + ".pid"), String(process.pid));',
    'require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {',
    '  const request = JSON.parse(line);',
    '  if (!Object.hasOwn(request, "id")) return;',
    '  const results = {',
    '    initialize: { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Workspace", version: "1" } },',
    '    "tools/list": { tools: [{ name: "cwd", description: "Read the current project directory", inputSchema: { type: "object" } }] },',
    '    "tools/call": { content: [{ type: "text", text: directory }] },',
    '  };',
    '  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: results[request.method] ?? {} }));',
    '});',
  ].join("\n"));
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "parallel-model", kind: "openai-compatible", name: "Parallel fixture",
        baseUrl, modelId, models: [{ id: modelId, name: "Parallel test model" }] }],
      activeProviderId: "parallel-model",
    });
    await window.pi.settingsSetNotificationsEnabled(false);
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await waitForProjectDraft(page, projectA);
  await page.evaluate(({ command, scriptPath }) => window.pi.mcpSave({
    id: crypto.randomUUID(), name: "Workspace", enabled: true, policy: "confirm",
    transport: { type: "stdio", command, args: [scriptPath] },
  }), { command: process.execPath, scriptPath: script });
  const memory = () => app.evaluate(({ app }) =>
    app.getAppMetrics().reduce((total, { memory }) => total + memory.workingSetSize, 0),
  );
  const idle = await memory();
  const card = page.locator("[data-permission-card]");
  const blocker = page.locator("[data-run-block]");
  const snapshot = () => page.evaluate(() => window.pi.getSnapshot());
  const chooseFolder = async (directory) => {
    await app.evaluate(({ dialog }, folder) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: [folder] };
      };
    }, directory);
    await page.keyboard.press("Control+o");
    await waitForProjectDraft(page, directory);
  };
  const row = (id) => page.locator('[data-session-id="' + id + '"]');
  const status = (id, value) => row(id).locator('[data-session-status="' + value + '"]');

  await resize(page, window, wide);
  await send(page, "Prepare parallel result A");
  const requestA = await model.nextCompletion();
  assert.ok(requestA.input.tools.some(({ function: tool }) => tool.description === description));
  sendTool(requestA, "parallel-write-a", "write_file", { path: output, content: "Result A" });
  await card.waitFor();
  const a = (await snapshot()).sessionId;
  await status(a, "approval").waitFor();

  await chooseFolder(projectB);
  await blocker.waitFor({ state: "hidden" });
  await send(page, "Prepare parallel result B");
  const requestB = await model.nextCompletion();
  const mcpTool = requestB.input.tools.find(({ function: tool }) => tool.description === description);
  assert.ok(mcpTool);
  sendTool(requestB, "parallel-write-b", "write_file", { path: output, content: "Result B" });
  await card.waitFor();
  const b = (await snapshot()).sessionId;
  await status(a, "approval").waitFor();
  await status(b, "approval").waitFor();
  const parallel = await memory();
  await page.reload();
  await card.waitFor();
  let live = await snapshot();
  assert.equal(live.sessionId, b);
  assert.equal(live.activeRuns.length, 2);
  assert.equal(live.pendingPermissions[0].callId, "parallel-write-b");

  await chooseFolder(projectC);
  const before = (await snapshot()).sessions.length;
  await send(page, "Keep this third draft");
  await blocker.getByText("此消息仍在草稿中。", { exact: true }).waitFor();
  live = await snapshot();
  assert.equal(live.sessionId, null);
  assert.equal(live.sessions.length, before);
  assert.deepEqual(live.composerDraft, ["Keep this third draft"]);
  let current = locales[0];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await assertFits(blocker);
        contrast = Math.min(contrast, await minimumTextContrast(blocker, "p, [data-slot=alert-description]"));
      }
    }
  }
  assert.ok(contrast >= 4.5, "Parallel capacity notice contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, wide);
  await page.evaluate((directory) => window.pi.sessionUseRecentProject(directory), projectA);
  await waitForProjectDraft(page, projectA);
  await send(page, "Keep this same-workspace draft");
  await blocker.getByText("Your message is still a draft.", { exact: true }).waitFor();
  const jump = button(blocker, "Go to task chat");
  await assertFits(jump);
  await jump.press("Enter");
  await card.and(page.locator(":focus")).waitFor();
  assert.equal((await snapshot()).sessionId, a);
  await button(card, "Allow once").press("Enter");
  const finalA = await model.nextCompletion();
  finalA.write({ content: "Only A finished." });
  finalA.finish();
  await page.getByText("Only A finished.", { exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 1);
  assert.equal(readFileSync(join(projectA, output), "utf8"), "Result A");
  assert.ok(!existsSync(join(projectB, output)));
  const gitA = await page.evaluate((id) => window.pi.sessionGitChanges(id), a);
  assert.ok(gitA.checkpoint.files.some(({ path }) => path === output));
  await status(b, "approval").waitFor();

  await row(b).click();
  await button(card, "Allow once").press("Enter");
  const toolRequest = await model.nextCompletion();
  sendTool(toolRequest, "parallel-mcp-b", mcpTool.function.name, {});
  await button(card, "Allow once").press("Enter");
  const finalB = await model.nextCompletion();
  assert.match(JSON.stringify(finalB.input.messages.at(-1)), /Parallel project B/);
  finalB.write({ content: "Only B is still streaming." });
  await page.getByText("Only B is still streaming.", { exact: true }).waitFor();

  await page.evaluate((directory) => window.pi.sessionUseRecentProject(directory), projectC);
  await waitForProjectDraft(page, projectC);
  await editor(page).press("Enter");
  const requestC = await model.nextCompletion();
  assert.equal(requestC.input.messages.at(-1).content, "Keep this third draft");
  const c = (await snapshot()).sessionId;
  await button(page, "Stop").press("Enter");
  await page.waitForFunction(async (id) =>
    (await window.pi.getSnapshot()).activeRuns.every(({ sessionId }) => sessionId !== id), c);
  await status(b, "running").waitFor();
  await row(b).click();
  await page.getByText("Only B is still streaming.", { exact: true }).waitFor();
  finalB.finish();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);
  assert.equal(readFileSync(join(projectB, output), "utf8"), "Result B");
  const gitB = await page.evaluate((id) => window.pi.sessionGitChanges(id), b);
  assert.ok(gitB.checkpoint.files.some(({ path }) => path === output));
  assert.ok(!existsSync(join(projectC, output)));
  for (const directory of projects) {
    const pid = Number(readFileSync(join(scratch, basename(directory) + ".pid"), "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  }
  console.log("Parallel notice minimum contrast " + contrast.toFixed(2) + ":1");
  console.log("Electron working set in KiB idle / two pending tasks / settled: " +
    [idle, parallel, await memory()].join(" / "));
}

async function openProjectConfiguration(page, locale) {
  const trigger = button(page, locale.more);
  const title = locale.lang === "en" ? "Project configuration" : "项目配置";
  await trigger.press("Enter");
  await page.getByRole("menuitem", { name: title + "…", exact: true }).press("Enter");
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await dialog.getByText("project-fixture", { exact: true }).waitFor();
  return { trigger, dialog };
}

export async function verifyProjectConfiguration(page, window, model, project) {
  const marker = join(project, "mcp-start.txt");
  const log = join(project, "verification.log");
  const command = "node verify-fixture.cjs";
  mkdirSync(join(project, ".pilot"));
  writeFileSync(join(project, ".pilot", "config.json"), JSON.stringify({
    permissions: { allow: [{ tool: "write_file", path: "drafts" }] },
    verification: { test: command, afterTurn: "test" },
  }));
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { "project-fixture": { command: process.execPath, args: ["project-fixture.cjs"] } },
  }));
  writeFileSync(join(project, "project-fixture.cjs"), [
    'const fs = require("node:fs");',
    'fs.writeFileSync("mcp-start.txt", String(process.pid));',
    'const input = require("node:readline").createInterface({ input: process.stdin });',
    'input.on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  if (!Object.hasOwn(message, "id")) return;',
    '  const results = {',
    '    initialize: { protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "Project fixture", version: "1.0" } },',
    '    "tools/list": { tools: [{ name: "status", description: "Read project fixture status", inputSchema: { type: "object" } }] },',
    '    "tools/call": { content: [{ type: "text", text: "Called the project MCP fixture" }] },',
    '  };',
    '  console.log(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: results[message.method] ?? {} }));',
    '});',
  ].join("\n"));
  writeFileSync(join(project, "verify-fixture.cjs"), [
    'require("node:fs").appendFileSync("verification.log", process.cwd() + "\\n");',
    'console.log("Verified the project declaration");',
  ].join("\n"));
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "project-model", kind: "openai-compatible", name: "Project fixture",
        baseUrl, modelId, models: [{ id: modelId, name: "Project test model" }] }],
      activeProviderId: "project-model",
    });
    await window.pi.settingsSetNotificationsEnabled(false);
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await waitForProjectDraft(page, project);

  let current = locales[0];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const { dialog, trigger } = await openProjectConfiguration(page, locale);
        await assertFits(dialog);
        await assertFits(button(dialog, locale.close));
        await dialog.getByText(command, { exact: true }).waitFor();
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, h3, p, code"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus")).waitFor();
      }
    }
  }
  assert.ok(contrast >= 4.5, "Project configuration text contrast " + contrast.toFixed(2) + ":1");
  console.log("Project sources at 1100 × 750 and 720 × 480, 150%, zh/en, light/dark, contrast " +
    contrast.toFixed(2) + ":1");

  const card = page.locator("[data-project-trust-card]");
  const toolDescription = "Read project fixture status";
  await send(page, "Continue without project settings");
  await card.getByText("Trust this project's configuration?", { exact: true }).waitFor();
  await page.keyboard.press("Control+l");
  await card.and(page.locator(":focus")).waitFor();
  await assertFits(card);
  await assertFits(button(card, "Skip for this run"));
  await assertFits(button(card, "Trust project configuration"));
  assert.ok(await minimumTextContrast(card, "h2, h3, p, code") >= 4.5);
  assert.ok(!existsSync(marker));
  assert.ok(!existsSync(log));
  await page.keyboard.press("Escape");
  const skipped = await model.nextCompletion();
  assert.ok(!skipped.input.tools.some(({ function: tool }) => tool.description === toolDescription));
  skipped.write({ content: "Continued without project settings." });
  skipped.finish();
  await button(page, "Send").waitFor();
  await editor(page).and(page.locator(":focus")).waitFor();
  assert.ok(!existsSync(marker));
  assert.ok(!existsSync(log));

  await resize(page, window, wide);
  await send(page, "Use the reviewed project settings");
  await card.getByText(command, { exact: true }).waitFor();
  await button(card, "Trust project configuration").press("Enter");
  const ready = await model.nextCompletion();
  const server = ready.input.tools.find(({ function: tool }) => tool.description === toolDescription);
  assert.ok(server, "Expected the trusted project MCP tool");
  const pid = Number(readFileSync(marker, "utf8"));
  assert.ok(pid > 0);
  sendTool(ready, "project-mcp-call", server.function.name, {});
  await button(page.locator("[data-permission-card]"), "Allow once").press("Enter");
  const result = await model.nextCompletion();
  assert.match(JSON.stringify(result.input.messages.find(({ role }) => role === "tool")), /Called the project MCP fixture/);
  result.write({ content: "Used the trusted project MCP service." });
  result.finish();
  await button(page, "Send").waitFor();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });

  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  await page.keyboard.press("Control+Shift+t");
  const panel = page.locator("[data-verification-panel]");
  await panel.locator('[data-verification-trigger="after-turn"] [data-verification-status="success"]').waitFor();
  assert.equal(readFileSync(log, "utf8").trim(), project);
  const input = panel.getByRole("textbox", { name: "Command", exact: true });
  await panel.locator("form [data-project-config-source]").getByText(".pilot/config.json").waitFor();
  assert.equal(await input.inputValue(), command);
  await button(panel, "Run").click();
  await panel.locator('[data-verification-detail]:not([data-verification-trigger]) [data-verification-status="success"]').waitFor();
  assert.deepEqual(readFileSync(log, "utf8").trim().split(/\r?\n/), [project, project]);
  return snapshot.sessionId;
}

export async function verifyRestoredProjectConfiguration(page, app, model, id, otherProject) {
  await page.evaluate((session) => window.pi.sessionLoad(session), id);
  const en = locales[1];
  await openSettings(page, en, "MCP servers");
  const mcp = page.locator('[data-project-config-settings="mcp"]');
  await mcp.getByText("project-fixture", { exact: true }).waitFor();
  await mcp.getByText(".mcp.json", { exact: true }).waitFor();
  await openSettings(page, en, "Permissions");
  const rules = page.locator('[data-project-config-settings="permissions"]');
  await rules.getByText("Trusted", { exact: true }).waitFor();
  await button(rules, "Project configuration…").press("Enter");
  const dialog = page.getByRole("dialog", { name: "Project configuration", exact: true });
  await button(dialog, "Revoke project trust").press("Enter");
  await dialog.getByText("Awaiting trust", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.keyboard.press("Control+l");
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, otherProject);
  await page.keyboard.press("Control+o");
  await waitForProjectDraft(page, otherProject);
  await send(page, "Run in the other project");
  const request = await model.nextCompletion();
  assert.ok(!request.input.tools.some(({ function: tool }) => tool.description === "Read project fixture status"));
  request.write({ content: "Ran in the other project." });
  request.finish();
  await page.getByText("Ran in the other project.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();

  await page.evaluate((session) => window.pi.sessionLoad(session), id);
  await send(page, "Ask again after trust was revoked");
  const card = page.locator("[data-project-trust-card]");
  await card.getByText("Trust this project's configuration?", { exact: true }).waitFor();
  await button(card, "Stop the task").press("Enter");
  await card.waitFor({ state: "hidden" });
  await button(page, "Send").waitFor();
}

async function interceptMcpBrowser(app) {
  await app.evaluate(({ shell }) => {
    globalThis.pilotMcpBrowserUrls = [];
    shell.openExternal = async (url) => { globalThis.pilotMcpBrowserUrls.push(url); };
  });
  return async () => {
    const deadline = performance.now() + 10_000;
    do {
      const opened = await app.evaluate(() => globalThis.pilotMcpBrowserUrls.shift());
      if (opened) return new URL(opened);
      await delay(30);
    } while (performance.now() < deadline);
    throw new Error("The system-browser handoff did not run");
  };
}

async function finishMcpBrowser(url, language = "en") {
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp('lang="' + language + '"'));
}

function mcpGrantText(profile) {
  return readFileSync(join(profile, "settings.json"), "utf8");
}

function mcpGrants(profile) {
  return JSON.parse(mcpGrantText(profile)).mcpOAuth ?? {};
}

export async function verifyMcpOAuth(page, window, app, fixture, profile) {
  const nextBrowser = await interceptMcpBrowser(app);
  const name = "OAuth desktop fixture";
  const id = await page.evaluate(async ({ name, url }) => {
    const id = crypto.randomUUID();
    await window.pi.mcpSave({ id, name, enabled: true, policy: "confirm", transport: { type: "http", url } });
    return id;
  }, { name, url: fixture.url });
  assert.equal(fixture.seen.authorized, 0);
  let current = locales[0];
  let contrast = Infinity;
  const row = page.locator(".settings-row").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const loginDialog = page.locator("[data-mcp-oauth-dialog]");
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      const english = locale.lang === "en";
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await openSettings(page, locale, english ? "MCP servers" : "MCP 服务");
        const trigger = button(row, english ? "Sign in…" : "登录…");
        await trigger.press("Enter");
        const url = await nextBrowser();
        assert.equal(url.origin, new URL(fixture.url).origin);
        await assertFits(loginDialog);
        await assertFits(button(loginDialog, english ? "Cancel sign-in" : "取消登录"));
        contrast = Math.min(contrast, await minimumTextContrast(loginDialog, "h2, p, bdi"));
        await page.keyboard.press("Escape");
        await loginDialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus")).waitFor();
      }
    }
  }
  assert.ok(contrast >= 4.5, "MCP OAuth dialog contrast " + contrast.toFixed(2) + ":1");
  console.log("MCP OAuth dialog checked at 1100 × 750 and 720 × 480, 150%, zh/en, light/dark, contrast " + contrast.toFixed(2) + ":1");
  assert.deepEqual(mcpGrants(profile), {});
  await button(row, "Sign in…").press("Enter");
  const url = await nextBrowser();
  const callback = new URL(url.searchParams.get("redirect_uri"));
  callback.searchParams.set("code", "wrong-code");
  callback.searchParams.set("state", "wrong-state");
  assert.equal((await fetch(callback)).status, 400);
  assert.deepEqual(mcpGrants(profile), {});
  await finishMcpBrowser(url);
  await loginDialog.waitFor({ state: "hidden" });
  await row.getByText("Signed in", { exact: true }).waitFor();
  await button(row, "Manage sign-in…").and(page.locator(":focus")).waitFor();
  await row.getByText(/Connected, 1 tool/).waitFor();
  const encrypted = mcpGrants(profile)[id]?.encryptedState;
  assert.ok(encrypted);
  assert.doesNotMatch(mcpGrantText(profile), /fixture-(?:access|refresh)-|codeVerifier|oauthState/);
  await resize(page, window, wide);
  return { id, name, encrypted };
}

export async function verifyRestoredMcpOAuth(page, app, model, fixture, profile, server, project) {
  const nextBrowser = await interceptMcpBrowser(app);
  await openSettings(page, locales[1], "MCP servers");
  const row = page.locator(".settings-row").filter({
    has: page.getByRole("heading", { name: server.name, exact: true }),
  });
  await row.getByText("Signed in", { exact: true }).waitFor();
  await row.getByText(/Connected, 1 tool/).waitFor();
  assert.equal(fixture.seen.refreshed, 1);
  assert.notEqual(mcpGrants(profile)[server.id]?.encryptedState, server.encrypted);

  fixture.expire(true);
  await button(row, "Actions for " + server.name).press("Enter");
  await page.getByRole("menuitem", { name: "Reconnect", exact: true }).press("Enter");
  const again = button(row, "Sign in again…");
  await again.press("Enter");
  await finishMcpBrowser(await nextBrowser());
  await row.getByText("Signed in", { exact: true }).waitFor();
  await button(row, "Manage sign-in…").press("Enter");
  await button(page.locator("[data-mcp-oauth-dialog]"), "Sign out").press("Enter");
  await row.getByText("Sign-in required", { exact: true }).waitFor();
  assert.deepEqual(mcpGrants(profile), {});

  const projectName = "Trusted OAuth project";
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({
    mcpServers: { [projectName]: { type: "http", url: fixture.url } },
  }));
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+o");
  await waitForProjectDraft(page, project);
  await openSettings(page, locales[1], "MCP servers");
  const projectList = page.locator('[data-project-config-settings="mcp"]');
  await projectList.getByText(projectName, { exact: true }).waitFor();
  assert.equal(await button(projectList, "Sign in…").count(), 0);
  await page.evaluate(async ({ baseUrl, modelId }) => {
    const { composerId } = await window.pi.getSnapshot();
    const config = await window.pi.sessionProjectConfig(composerId);
    await window.pi.sessionSetProjectTrust(composerId, config.directory, config.revision);
    await window.pi.settingsSave({
      providers: [{ id: "mcp-oauth-model", kind: "openai-compatible", name: "MCP fixture model", baseUrl, modelId }],
      activeProviderId: "mcp-oauth-model",
    });
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await button(projectList, "Sign in…").press("Enter");
  await finishMcpBrowser(await nextBrowser());
  await projectList.getByText("Signed in", { exact: true }).waitFor();
  const ids = Object.keys(mcpGrants(profile));
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^project:/);
  await page.keyboard.press("Control+l");
  await send(page, "Use the authenticated project tool");
  const request = await model.nextCompletion();
  const tool = request.input.tools.find(({ function: entry }) => entry.description === "Read signed-in fixture");
  assert.ok(tool);
  sendTool(request, "oauth-fixture-call", tool.function.name, {});
  await button(page.locator("[data-permission-card]"), "Allow once").press("Enter");
  const result = await model.nextCompletion();
  assert.match(JSON.stringify(result.input.messages.find(({ role }) => role === "tool")), /Signed-in MCP tool executed/);
  result.write({ content: "Called the OAuth-protected project tool." });
  result.finish();
  await page.getByText("Called the OAuth-protected project tool.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  await page.evaluate(async () => {
    const { composerId } = await window.pi.getSnapshot();
    const config = await window.pi.sessionProjectConfig(composerId);
    await window.pi.sessionSetProjectTrust(composerId, config.directory, null);
  });
  assert.deepEqual(mcpGrants(profile), {});
}

export async function verifyGitPublishing(page, window, app, project, remote) {
  const git = (...args) => execFileSync("git", args, {
    cwd: project, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "-q", "--initial-branch=main");
  git("init", "-q", "--bare", "--initial-branch=main", remote);
  git("config", "user.name", "Pilot Desktop Test");
  git("config", "user.email", "pilot@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("commit", "-q", "--allow-empty", "-m", "Initial branch");
  git("remote", "add", "origin", remote);
  git("push", "-qu", "origin", "main");

  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await page.evaluate(() => window.pi.sessionSelectProject("en"));
  await waitForProjectDraft(page, project);
  await resize(page, window, wide);
  const en = locales[1];
  const zh = locales[0];
  const actions = page.locator("[data-git-branch-actions]");
  const openChanges = async (locale) => {
    if (!(await actions.isVisible())) {
      if (await page.locator("[data-review-layout]").isVisible())
        await page.getByRole("tab", { name: new RegExp("^" + locale.tabs[0]) }).press("Enter");
      else await page.keyboard.press("Control+Shift+d");
    }
    await actions.waitFor();
  };
  await openChanges(en);
  const branches = button(actions, "Branches…");
  const dialog = page.getByRole("dialog", { name: "Create or switch branches" });
  await branches.press("Enter");
  const input = dialog.getByRole("textbox", { name: "New branch name" });
  await input.fill("feature/desktop");
  assert.equal(await dialog.locator('[aria-current="true"]').innerText(), "main");
  await input.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await branches.and(page.locator(":focus")).waitFor();
  assert.equal(git("branch", "--show-current"), "feature/desktop");
  await page.locator('header [title="Git branch feature/desktop"]').waitFor({ state: "attached" });

  git("commit", "-q", "--allow-empty", "-m", "Review this desktop commit");
  const latest = git("rev-parse", "HEAD");
  const destination = "refs/heads/feature/desktop";
  let minContrast = Infinity;
  let current = en;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of [en, zh]) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await openChanges(locale);
        const push = button(actions, locale === zh ? "推送…" : "Push…");
        await push.press("Enter");
        const preview = page.getByRole("dialog", { name: locale === zh ? "预览推送" : "Preview push" });
        await preview.getByText("Review this desktop commit", { exact: true }).waitFor();
        await preview.getByText("origin/feature/desktop", { exact: true }).waitFor();
        await assertFits(preview);
        await assertFits(button(preview, locale === zh ? "确认推送" : "Confirm push"));
        minContrast = Math.min(minContrast, await minimumTextContrast(preview, "h2, h3, p, dt, dd"));
        const cancel = button(preview, locale === zh ? "取消" : "Cancel");
        await cancel.and(page.locator(":focus")).waitFor();
        await cancel.press("Escape");
        await preview.waitFor({ state: "hidden" });
        await push.and(page.locator(":focus")).waitFor();
        assert.equal(git("ls-remote", "--heads", "origin", destination), "");
        await page.keyboard.press("Escape");
        await actions.waitFor({ state: "hidden" });
      }
    }
  }
  assert.ok(minContrast >= 4.5, "Push review text must meet the contrast requirement");
  console.log("Git push preview text minimum contrast " + minContrast.toFixed(2) + ":1");

  await resize(page, window, wide);
  await selectAppearance(page, current, en, "light");
  await openChanges(en);
  await button(actions, "Push…").press("Enter");
  const preview = page.getByRole("dialog", { name: "Preview push" });
  await preview.getByText(latest.slice(0, 12), { exact: true }).waitFor();
  await button(preview, "Confirm push").press("Enter");
  await preview.waitFor({ state: "hidden" });
  await page.getByText("Pushed to origin/feature/desktop", { exact: true }).waitFor();
  assert.equal(git("ls-remote", "--heads", "origin", destination), latest + "\t" + destination);
  assert.equal(git("rev-parse", "--abbrev-ref", "@{upstream}"), "origin/feature/desktop");
  await branches.press("Enter");
  await button(dialog, "Switch to main").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(git("branch", "--show-current"), "main");
  await page.locator('header [title="Git branch main"]').waitFor({ state: "attached" });
}

export async function verifyGitAnnotations(page, window, app, model, repository) {
  const project = join(repository, "module");
  mkdirSync(project);
  const git = (...args) => execFileSync("git", args, {
    cwd: repository, windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const amended = "notes # current.txt";
  const deleted = "obsolete.txt";
  const existingDraft = "Keep this original instruction.";
  const firstComment = "Keep the revised lines together.";
  const secondComment = "Explain why the old entry was removed.";
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Pilot Desktop Test");
  git("config", "user.email", "pilot@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(project, amended), "Header\nOld item\nFooter\n");
  writeFileSync(join(project, deleted), "Previous setting\nObsolete value\nRetired help\n");
  git("add", ".");
  git("commit", "-qm", "Baseline for diff comments");
  writeFileSync(join(project, amended), "Header\nNew item A\nNew item B\nFooter\n");
  unlinkSync(join(project, deleted));
  const before = git("status", "--porcelain=v1");

  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  const opened = await page.evaluate(() => window.pi.sessionSelectProject("en"));
  assert.equal(opened.draftWorkingDirectory, project);
  await editor(page).fill(existingDraft);
  await page.waitForFunction(async ([composerId, draft]) => {
    const current = await window.pi.getSnapshot();
    return !current.sessionId && current.composerId === composerId &&
      current.composerDraft.join("") === draft;
  }, [opened.composerId, existingDraft]);

  const openChanges = async (locale) => {
    const trigger = page.locator("#review-trigger");
    if (await trigger.getAttribute("aria-expanded") === "false") await trigger.click();
    const tab = page.getByRole("tab", { name: new RegExp("^" + locale.tabs[0]) });
    if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  };
  const openComment = async (path, locale) => {
    await openChanges(locale);
    const file = page.locator('[data-git-file="module/' + path + '"]');
    const toggle = file.locator("[data-git-diff-toggle]");
    if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    const trigger = button(file, locale === locales[1] ? "Comment on lines…" : "批注行…");
    await trigger.click();
    return {
      trigger,
      dialog: page.getByRole("dialog", { name: locale === locales[1] ? "Add diff comment" : "添加差异批注" }),
    };
  };
  let current = locales[1];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        const { trigger, dialog } = await openComment(amended, locale);
        const line = dialog.locator("[data-git-annotation-row][tabindex='0']");
        await line.and(page.locator(":focus")).waitFor();
        await assertFits(dialog);
        await assertFits(button(dialog, locale === locales[1] ? "Save comment" : "保存批注"));
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, p, label"));
        await line.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus")).waitFor();
        await trigger.press("Escape");
        await page.locator("[data-review-layout]").waitFor({ state: "hidden" });
      }
    }
  }
  assert.ok(contrast >= 4.5, "Diff comment text must meet text contrast requirements");
  console.log("Diff comment text minimum contrast " + contrast.toFixed(2) + ":1");

  const en = locales[1];
  await selectAppearance(page, current, en, "light");
  const add = async (path, comment, select) => {
    const { trigger, dialog } = await openComment(path, en);
    await select(dialog);
    await dialog.getByRole("textbox", { name: "Comment", exact: true }).fill(comment);
    await button(dialog, "Save comment").press("Enter");
    await dialog.waitFor({ state: "hidden" });
    await trigger.and(page.locator(":focus")).waitFor();
  };
  await add(amended, "Earlier wording", async dialog => {
    await button(dialog, "Select old line 2").click();
    await button(dialog, "Select new line 3").click({ modifiers: ["Shift"] });
    assert.equal(await dialog.locator("[data-git-annotation-row][aria-pressed='true']").count(), 3);
    await dialog.getByText("Old lines 2", { exact: true }).waitFor();
    await dialog.getByText("New lines 2–3", { exact: true }).waitFor();
  });
  await add(deleted, secondComment, async dialog => {
    const firstLine = button(dialog, "Select old line 1");
    await firstLine.and(page.locator(":focus")).waitFor();
    await firstLine.press("Shift+ArrowDown");
    await dialog.getByText("Old lines 1–2", { exact: true }).waitFor();
  });
  await add(deleted, "Remove this draft comment", async () => {});
  await button(page, "Review comments (3)…").click();
  const queue = page.getByRole("dialog", { name: "Diff comments" });
  await assertFits(queue);
  await button(queue, "Remove comment 3").click();
  await button(queue, "Edit comment 1").click();
  await queue.getByRole("textbox", { name: "Comment", exact: true }).fill(firstComment);
  await button(queue, "Save comment").click();
  await queue.getByText(firstComment, { exact: true }).waitFor();
  await assertFits(button(queue, "Add to draft"));
  await button(queue, "Add to draft").click();
  await queue.waitFor({ state: "hidden" });
  await editor(page).and(page.locator(":focus")).waitFor();
  await editor(page).getByText(amended + ":2–3", { exact: true }).waitFor();
  await editor(page).getByText(deleted + ":1–2", { exact: true }).waitFor();
  assert.ok((await editor(page).innerText()).startsWith(existingDraft));
  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.composerId, opened.composerId);
  assert.equal(snapshot.composerDraft.filter(part => typeof part !== "string").length, 2);

  await page.reload();
  await editor(page).getByText(amended + ":2–3", { exact: true }).waitFor();
  await editor(page).press("Enter");
  const reply = await model.nextCompletion();
  const user = reply.input.messages.filter(message => message.role === "user");
  assert.equal(user.length, 1);
  const prompt = JSON.stringify(user[0].content);
  assert.ok(prompt.includes(existingDraft) && prompt.includes(firstComment) && prompt.includes(secondComment));
  assert.match(prompt, /old \\"notes # current\.txt\\" lines 2/);
  assert.match(prompt, /new \\"notes # current\.txt\\" lines 2–3/);
  assert.match(prompt, /old \\"obsolete\.txt\\" lines 1–2/);
  assert.ok(prompt.includes("- Old item") && prompt.includes("+ New item B") && prompt.includes("- Obsolete value"));
  assert.ok(!prompt.includes("Remove this draft comment") && !prompt.includes("module/notes"));
  reply.write({ content: "Received both diff comments." });
  reply.finish();
  await page.getByText("Received both diff comments.", { exact: true }).waitFor();
  const cite = page.getByRole("button", { name: amended + ":2–3", exact: true });
  await cite.click();
  await page.locator("[data-reference-line='2']").getByText("New item A", { exact: true }).waitFor();
  assert.equal(git("status", "--porcelain=v1"), before);
  const result = await page.evaluate(() => window.pi.getSnapshot());
  assert.ok(result.sessionId && result.messages.filter(message => message.role === "user").length === 1);
  return { project, amended };
}

function externalEditorSection(page) {
  return page.locator('[aria-labelledby="settings-external-editor"]');
}

export async function verifyExternalEditor(page, window, fixture, { project, amended }) {
  const args = [fixture.script, fixture.output, "{file}", "line {line}"];
  writeFileSync(fixture.script, [
    'const { renameSync, writeFileSync } = require("node:fs");',
    'const [, , output, ...args] = process.argv;',
    'writeFileSync(output + ".tmp", JSON.stringify(args));',
    'renameSync(output + ".tmp", output);',
  ].join("\n"));

  const section = externalEditorSection(page);
  const picker = section.getByRole("combobox");
  const launcher = section.locator("#external-editor-command");
  const parameters = section.locator("#external-editor-args");
  const en = locales[1];
  const reference = button(page, amended + ":2–3");
  const preview = page.locator("[data-workspace-reference-panel]");
  const openPreview = async locale => {
    if (!(await preview.isVisible())) await reference.press("Enter");
    const action = button(preview, locale === en ? "Open in editor" : "在编辑器中打开");
    await action.waitFor();
    return action;
  };
  const openGeneral = async locale => {
    await openSettings(page, locale, locale === en ? "General" : "常规");
    await section.waitFor();
  };
  const save = async () => {
    await button(section, "Save").press("Enter");
    await section.getByText("Saved", { exact: true }).waitFor();
    await button(section, "Save").and(page.getByRole("button", { disabled: true })).waitFor();
  };
  const checkLaunch = async (action, line) => {
    if (existsSync(fixture.output)) unlinkSync(fixture.output);
    await action.press("Enter");
    const deadline = performance.now() + 10_000;
    while (!existsSync(fixture.output) && performance.now() < deadline) await delay(60);
    assert.ok(existsSync(fixture.output), "The configured launcher must record its arguments");
    assert.deepEqual(JSON.parse(readFileSync(fixture.output, "utf8")), [
      join(project, amended), "line " + line,
    ]);
  };

  await openGeneral(en);
  const search = page.getByRole("searchbox", { name: "Search settings" });
  await search.fill("External editor");
  await search.press("Enter");
  assert.match(await picker.innerText(), /VS Code/);
  await picker.press("Space");
  for (const name of ["VS Code", "Cursor", "JetBrains", "Custom command"])
    await assertFits(page.getByRole("option", { name, exact: true }));
  await page.getByRole("option", { name: "JetBrains", exact: true }).press("Enter");
  await launcher.waitFor();
  await parameters.waitFor({ state: "hidden" });
  await picker.press("Space");
  await page.getByRole("option", { name: "Custom command", exact: true }).press("Enter");
  await launcher.fill(fixture.launcher);
  await parameters.fill("{line}");
  await button(section, "Save").press("Enter");
  await section.getByRole("alert").getByText("Add {file} to the arguments.", { exact: true }).waitFor();
  await parameters.and(page.locator(":focus")).waitFor();
  await parameters.fill(args.join("\n"));
  await save();
  await page.keyboard.press("Control+l");
  await checkLaunch(await openPreview(en), 2);
  const changes = page.getByRole("tab", { name: /^Changes/ });
  await changes.press("Enter");
  const file = page.locator('[data-git-file="module/' + amended + '"]');
  const toggle = file.locator("[data-git-diff-toggle]");
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.press("Enter");
  await checkLaunch(button(file, "Open line 3 in editor"), 3);

  let locale = en;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const nextLocale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, locale, nextLocale, theme);
        locale = nextLocale;
        await openGeneral(locale);
        await picker.scrollIntoViewIfNeeded();
        await assertFits(picker);
        await page.waitForFunction(() => {
          const view = document.querySelector(".settings-scroll");
          return view && view.scrollWidth <= view.clientWidth + 1;
        });
        await picker.press("Space");
        const selected = page.getByRole("option", { selected: true });
        await assertFits(selected);
        assert.match(await selected.innerText(), locale === en ? /Custom command/ : /自定义命令/);
        await page.keyboard.press("Escape");
        await picker.and(page.locator(":focus")).waitFor();
        await parameters.scrollIntoViewIfNeeded();
        await assertFits(parameters);
        await page.keyboard.press("Control+l");
        await assertFits(await openPreview(locale));
        console.log("Checked external editor at " + size.width + " × " + size.height + " " +
          zoom * 100 + "% " + locale.lang + " " + theme);
      }
    }
  }

  await openGeneral(en);
  await launcher.fill(fixture.missing);
  await save();
  await page.keyboard.press("Control+l");
  await (await openPreview(en)).press("Enter");
  await page.locator("[data-feedback-bar]").getByText(
    "Editor not found. Check the installation or launcher under Settings → General.",
    { exact: true },
  ).waitFor();
  await openGeneral(en);
  await launcher.fill(fixture.launcher);
  await save();
}

export async function verifyRestoredExternalEditor(page, fixture) {
  const current = await page.evaluate(() => window.pi.settingsGet());
  assert.deepEqual(current.externalEditor, {
    kind: "custom",
    command: fixture.launcher,
    args: [fixture.script, fixture.output, "{file}", "line {line}"],
  });
  await openSettings(page, locales[1], "General");
  const section = externalEditorSection(page);
  assert.equal(await section.locator("#external-editor-command").inputValue(), fixture.launcher);
  await page.keyboard.press("Control+l");
}

async function chooseUtilityModel(page, option) {
  await openSettings(page, locales[1], "Models & providers");
  const trigger = button(page, "Auxiliary model");
  await trigger.press("Enter");
  const item = page.getByRole("menuitemradio", { name: option });
  await item.press("Enter");
  await trigger.and(page.locator(":focus")).waitFor();
  await button(page.getByRole("main"), "Save").press("Enter");
  await page.getByRole("main").getByText("Saved", { exact: true }).waitFor();
  await page.keyboard.press("Control+l");
  await editor(page).and(page.locator(":focus")).waitFor();
}

async function waitForSessionTitle(page, title) {
  const result = await page.waitForFunction(async (title) => {
    const snapshot = await window.pi.getSnapshot();
    const session = snapshot.sessions.find(({ id }) => id === snapshot.sessionId);
    return session?.title === title ? session : false;
  }, title);
  return result.jsonValue();
}

export async function verifyAuxiliaryModels(page, window, model) {
  const en = locales[1];
  await page.evaluate(async ({ baseUrl, modelId, visionModelId, utilityModelId }) => {
    localStorage.setItem("pilot-locale", "en");
    await window.pi.settingsSave({
      providers: [
        {
          id: "primary-model-fixture", kind: "openai-compatible", name: "Conversation provider",
          baseUrl, modelId, models: [
            { id: modelId, name: "Main conversation model" },
            { id: visionModelId, name: "Vision conversation model" },
          ],
        },
        {
          id: "aux-model-fixture", kind: "openai-compatible", name: "Utility provider",
          baseUrl, modelId: utilityModelId, models: [{ id: utilityModelId, name: "Small utility model" }],
        },
      ],
      activeProviderId: "primary-model-fixture",
    });
  }, { baseUrl: model.baseUrl, modelId: model.modelId, visionModelId: model.visionModelId, utilityModelId: model.utilityModelId });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await editor(page).waitFor();
  await chooseUtilityModel(page, /Small utility model/);

  let locale = en;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const next of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, locale, next, theme);
        locale = next;
        await openSettings(page, locale, locale === en ? "Models & providers" : "模型与提供方");
        const trigger = button(page, locale === en ? "Auxiliary model" : "辅助模型");
        await trigger.scrollIntoViewIfNeeded();
        await assertFits(trigger);
        await trigger.press("Enter");
        const selected = page.getByRole("menuitemradio", { checked: true, name: /Small utility model/ });
        await assertFits(selected);
        await selected.getByText("Utility provider", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await trigger.and(page.locator(":focus")).waitFor();
        await page.keyboard.press("Control+l");
        await editor(page).and(page.locator(":focus")).waitFor();
        console.log("Checked auxiliary model at " + size.width + " × " + size.height + " " +
          zoom * 100 + "% " + locale.lang + " " + theme);
      }
    }
  }
  await resize(page, window, wide);

  const firstPrompt = "Draft a weekly report with these earlier requirements. " + "Keep project details. ".repeat(80);
  const generatedTitle = "Weekly project report";
  await send(page, firstPrompt);
  const first = await model.nextCompletion();
  assert.equal(first.input.model, model.modelId);
  first.write({ content: "First report reply." });
  first.finish();
  const title = await model.nextUtilityCompletion();
  assert.equal(title.input.model, model.utilityModelId);
  assert.match(title.input.messages[0].content, /^Generate a short conversation title/);
  assert.equal((title.input.tools ?? []).length, 0);
  const source = JSON.parse(title.input.messages.at(-1).content);
  assert.ok(firstPrompt.startsWith(source.user) && source.user.startsWith("Draft a weekly report"));
  assert.equal(source.reply, "First report reply.");
  title.write({ content: generatedTitle });
  title.finish();
  const firstChat = await waitForSessionTitle(page, generatedTitle);
  assert.equal(firstChat.titleGenerated, true);
  await page.locator('[data-session-id="' + firstChat.id + '"]').getByText(generatedTitle, { exact: true }).waitFor();

  await send(page, "Continue the weekly report.");
  const second = await model.nextCompletion();
  assert.equal(second.input.model, model.modelId);
  second.write({ content: "Second report reply." });
  second.finish();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);
  await page.locator("[data-context-usage]").press("Enter");
  await button(page, "Compact context").press("Enter");
  const summary = await model.nextUtilityCompletion();
  assert.equal(summary.input.model, model.utilityModelId);
  assert.match(summary.input.messages[0].content, /^Summarize the supplied conversation history/);
  assert.match(summary.input.messages.at(-1).content, /earlier requirements/);
  summary.write({ content: "Keep project details in the weekly report." });
  summary.finish();
  const compacted = page.locator("[data-context-compaction]");
  await button(compacted, "Context compacted").press("Enter");
  await compacted.getByText("Keep project details in the weekly report.", { exact: true }).waitFor();
  await waitForSessionTitle(page, generatedTitle);

  await page.keyboard.press("Control+n");
  await page.waitForFunction(async () => !(await window.pi.getSnapshot()).sessionId);
  await send(page, "Prepare a note with a title I will change.");
  const next = await model.nextCompletion();
  assert.equal(next.input.model, model.modelId);
  next.write({ content: "Here is the note." });
  next.finish();
  const late = await model.nextUtilityCompletion();
  assert.match(late.input.messages[0].content, /^Generate a short conversation title/);
  const manual = await page.evaluate(async () => {
    const { sessionId } = await window.pi.getSnapshot();
    await window.pi.sessionRename(sessionId, "My manual title");
    return sessionId;
  });
  late.write({ content: "Late generated title" });
  late.finish();
  await waitForSessionTitle(page, "My manual title");
  return { generated: firstChat.id, manual, title: generatedTitle };
}

export async function verifyRestoredAuxiliaryModels(page, model, chats) {
  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  assert.deepEqual(snapshot.settings.auxiliaryModel, {
    providerId: "aux-model-fixture", modelId: model.utilityModelId,
  });
  assert.equal(snapshot.sessions.find(({ id }) => id === chats.generated)?.title, chats.title);
  assert.equal(snapshot.sessions.find(({ id }) => id === chats.manual)?.title, "My manual title");
  await chooseUtilityModel(page, "Follow current model");
  assert.equal((await page.evaluate(() => window.pi.settingsGet())).auxiliaryModel, null);
  await page.keyboard.press("Control+n");
  await page.waitForFunction(async () => !(await window.pi.getSnapshot()).sessionId);
  await page.evaluate(async modelId => {
    const { composerId } = await window.pi.getSnapshot();
    await window.pi.sessionUpdateSettings(composerId, { model: { providerId: "primary-model-fixture", modelId } });
  }, model.visionModelId);
  await send(page, "Use this chat model");
  const reply = await model.nextCompletion();
  assert.equal(reply.input.model, model.visionModelId);
  reply.write({ content: "Reply using this chat model." });
  reply.finish();
  await page.waitForFunction(async () => {
    const snapshot = await window.pi.getSnapshot();
    return snapshot.sessions.some(session => session.id === snapshot.sessionId && session.titleGenerated);
  });
  assert.ok(model.titles.some(title => title.user === "Use this chat model" && title.model === model.visionModelId));
}

const desktopPlugin = "desktop-workflow";
const desktopSkill = "Desktop plugin skill";
const desktopTemplate = "/prompt-desktop-workflow-review";
const desktopMcp = desktopPlugin + " / fixture";

function writePluginVersion(fixture, version) {
  const { root, marker } = fixture;
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({
    name: desktopPlugin, version, commands: "./commands",
  }));
  writeFileSync(join(root, "scripts", "fixture.cjs"), [
    'const { writeFileSync } = require("node:fs");',
    'const { createInterface } = require("node:readline");',
    "const version = " + JSON.stringify(version) + ";",
    "writeFileSync(" + JSON.stringify(marker) + ", JSON.stringify({ version, pid: process.pid }));",
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    "  const request = JSON.parse(line);",
    '  if (!Object.hasOwn(request, "id")) return;',
    "  const results = {",
    "    initialize: { protocolVersion: request.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'Pilot Fixture', version } },",
    "    'tools/list': { tools: [{ name: 'fixture_status', description: 'Read plugin fixture status', inputSchema: { type: 'object', properties: {} } }] },",
    "    'tools/call': { content: [{ type: 'text', text: 'Plugin fixture version ' + version }] },",
    "  };",
    '  console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: results[request.method] ?? {} }));',
    "});",
  ].join("\n"));
  execFileSync("git", ["-c", "core.autocrlf=false", "add", "--all"], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Pilot Desktop Test", "-c", "user.email=pilot@example.invalid",
    "-c", "commit.gpgSign=false", "commit", "-qm", "Fixture version " + version,
  ], { cwd: root });
}

function preparePluginFixture(fixture) {
  const { root, archive } = fixture;
  execFileSync("git", ["init", "-q", "--template=", root]);
  for (const folder of [".claude-plugin", "commands", "hooks", "skills/check", "scripts"])
    mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, "skills", "check", "SKILL.md"),
    "---\nname: " + desktopSkill + "\ndescription: Read the plugin fixture.\n---\nReview the fixture.");
  writeFileSync(join(root, "commands", "review.md"), "Review $ARGUMENTS with the desktop plugin.");
  writeFileSync(join(root, "hooks", "hooks.json"), "{}");
  const launch = "\u0024{CLAUDE_PLUGIN_ROOT}/scripts/fixture.cjs";
  writeFileSync(join(root, ".mcp.json"), JSON.stringify({
    mcpServers: { fixture: { command: process.execPath, args: [launch] } },
  }));
  writePluginVersion(fixture, "1.0.0");
  execFileSync("git", [
    "archive", "--format=zip", "--prefix=workflow/", "--output=" + archive, "HEAD",
  ], { cwd: root });
}

function installedDesktopPlugin(page) {
  return page.locator("[data-installed-plugin]").filter({ hasText: desktopPlugin });
}

async function enableDesktopPlugin(page, row, fixture, version) {
  await button(row, "Enable components").press("Enter");
  await row.getByText(/· Enabled/).waitFor();
  const servers = await page.evaluate(() => window.pi.mcpList());
  const server = servers.find(({ name }) => name === desktopMcp);
  assert.equal(server?.status, "connected", server?.error);
  const processInfo = JSON.parse(readFileSync(fixture.marker, "utf8"));
  assert.equal(processInfo.version, version);
  process.kill(processInfo.pid, 0);
  return processInfo.pid;
}

export async function verifyPluginPackages(page, window, app, model, fixture) {
  const en = locales[1];
  preparePluginFixture(fixture);
  await page.evaluate(async ({ baseUrl, modelId }) => {
    localStorage.setItem("pilot-locale", "en");
    await window.pi.settingsSave({
      providers: [{ id: "plugin-fixture", kind: "openai-compatible", name: "Plugin fixture", baseUrl, modelId }],
      activeProviderId: "plugin-fixture",
    });
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const row = installedDesktopPlugin(page);
  let locale = en;
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const next of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, locale, next, theme);
        locale = next;
        const english = locale === en;
        await openSettings(page, locale, english ? "Plugins" : "插件");
        const trigger = button(page, english ? "Install plugin…" : "安装插件…");
        await trigger.scrollIntoViewIfNeeded();
        await assertFits(trigger);
        await trigger.press("Enter");
        const dialog = page.getByRole("dialog", { name: english ? "Install plugin" : "安装插件" });
        const field = dialog.getByRole("textbox", { name: english ? "Git repository URL" : "Git 地址" });
        await field.and(page.locator(":focus-visible")).waitFor();
        for (const label of english ? ["Choose folder…", "Choose ZIP archive…"] : ["选择插件文件夹…", "选择 ZIP 压缩包…"])
          await assertFits(button(dialog, label));
        await field.fill(fixture.root);
        await field.press("Enter");
        await dialog.getByRole("heading", { name: desktopPlugin }).and(page.locator(":focus-visible")).waitFor();
        await assertFits(dialog);
        await assertFits(button(dialog, english ? "Confirm installation" : "确认安装"));
        assert.ok(await dialog.locator("[data-plugin-review]").evaluate((area) => area.scrollWidth <= area.clientWidth + 1));
        contrast = Math.min(contrast, await minimumTextContrast(dialog, "h2, h3, p, li, summary"));
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await trigger.and(page.locator(":focus-visible")).waitFor();
        await page.keyboard.press("Control+l");
        await editor(page).and(page.locator(":focus")).waitFor();
        console.log("Checked plugin preview at " + size.width + " × " + size.height + " " +
          zoom * 100 + "% " + locale.lang + " " + theme);
      }
    }
  }
  assert.ok(contrast >= 4.5, "Plugin preview text must meet the contrast requirement");
  console.log("Plugin preview text minimum contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, wide);
  await openSettings(page, en, "Plugins");
  const install = button(page, "Install plugin…");
  const dialog = page.getByRole("dialog", { name: "Install plugin" });
  for (const [label, property, path] of [
    ["Choose folder…", "openDirectory", fixture.root],
    ["Choose ZIP archive…", "openFile", fixture.archive],
  ]) {
    await app.evaluate(({ dialog }, { expected, selected }) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async (options) => {
        dialog.showOpenDialog = original;
        if (!options.properties.includes(expected)) throw new Error("Unexpected picker mode");
        return { canceled: false, filePaths: [selected] };
      };
    }, { expected: property, selected: path });
    await install.press("Enter");
    await button(dialog, label).press("Enter");
    await dialog.getByRole("heading", { name: desktopPlugin }).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
  await install.press("Enter");
  const field = dialog.getByRole("textbox", { name: "Git repository URL" });
  await field.fill("missing-plugin");
  await field.press("Enter");
  await dialog.getByRole("alert").filter({ hasText: /Could not read the plugin source/ }).waitFor();
  await field.fill(fixture.root);
  await field.press("Enter");
  for (const text of [desktopSkill, desktopTemplate, "scripts/fixture.cjs", "Hooks"])
    await dialog.getByText(text, { exact: true }).waitFor();
  await dialog.getByText(/^Version 1\.0\.0 · [a-f0-9]{12}$/).waitFor();
  await dialog.getByText(/\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/fixture.cjs/).waitFor();
  assert.ok(!existsSync(fixture.marker));
  await button(dialog, "Confirm installation").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await row.getByText(/Version 1.0.0 · Off/).waitFor();
  assert.ok(!existsSync(fixture.marker));
  assert.deepEqual(await page.evaluate(async () => {
    const { settings, composerId } = await window.pi.getSnapshot();
    return {
      templates: settings.pluginPromptTemplates,
      services: (await window.pi.mcpList()).map(({ status }) => status),
      skills: (await window.pi.skillsList(composerId)).map(({ enabled }) => enabled),
    };
  }), { templates: [], services: ["disabled"], skills: [false] });

  const pid = await enableDesktopPlugin(page, row, fixture, "1.0.0");
  await page.keyboard.press("Control+l");
  await chooseSlash(page, desktopTemplate);
  const parameters = page.getByRole("dialog", { name: "Fill template parameters" });
  await parameters.getByRole("textbox", { name: "arguments", exact: true }).fill("the fixture");
  await button(parameters, "Insert into draft").press("Enter");
  await parameters.waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("[data-composer-editor]")?.innerText === "Review the fixture with the desktop plugin.",
  );
  await editor(page).press("Enter");
  const request = await model.nextCompletion();
  assert.match(request.input.messages.find(({ role }) => role === "system").content, /Desktop plugin skill/);
  const tool = request.input.tools.find(({ function: entry }) => entry.description === "Read plugin fixture status");
  assert.ok(tool, "The agent should receive the installed plugin's MCP tool");
  sendTool(request, "plugin-fixture-call", tool.function.name, {});
  await button(page.locator("[data-permission-card]"), "Allow once").press("Enter");
  const response = await model.nextCompletion();
  assert.match(JSON.stringify(response.input.messages.find(({ role }) => role === "tool")), /Plugin fixture version 1\.0\.0/);
  response.write({ content: "Verified the plugin fixture." });
  response.finish();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);

  await openSettings(page, en, "Plugins");
  const update = page.getByRole("dialog", { name: "Check for plugin updates" });
  await button(row, "Check for updates").press("Enter");
  await update.getByText("The plugin is up to date.").waitFor();
  await page.keyboard.press("Escape");
  await update.waitFor({ state: "hidden" });
  writePluginVersion(fixture, "2.0.0");
  await button(row, "Check for updates").press("Enter");
  await update.getByText(/^Version 2\.0\.0 · [a-f0-9]{12}$/).waitFor();
  const change = update.locator("summary").filter({ hasText: /Modified scripts\/fixture\.cjs/ });
  await change.press("Enter");
  await update.getByText("Previous version excerpt").waitFor();
  await update.getByText("New version excerpt").waitFor();
  writePluginVersion(fixture, "3.0.0");
  await button(update, "Install update").press("Enter");
  await update.getByRole("alert").filter({ hasText: /content or installation changed/ }).waitFor();
  await button(update, "Refresh preview").press("Enter");
  await update.getByText(/^Version 3\.0\.0 · [a-f0-9]{12}$/).waitFor();
  await button(update, "Install update").press("Enter");
  await update.waitFor({ state: "hidden" });
  await row.getByText(/Version 3.0.0 · Off/).waitFor();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(JSON.parse(readFileSync(fixture.marker, "utf8")).version, "1.0.0");
}

export async function verifyRestoredPluginPackages(page, fixture, profile) {
  await openSettings(page, locales[1], "Plugins");
  const row = installedDesktopPlugin(page);
  await row.getByText(/Version 3.0.0 · Off/).waitFor();
  const pid = await enableDesktopPlugin(page, row, fixture, "3.0.0");
  const trigger = button(row, "Uninstall");
  const remove = page.getByRole("dialog", { name: "Uninstall plugin" });
  await trigger.press("Enter");
  await remove.waitFor();
  await page.keyboard.press("Escape");
  await remove.waitFor({ state: "hidden" });
  await trigger.and(page.locator(":focus")).waitFor();
  await trigger.press("Enter");
  await button(remove, "Confirm uninstall").press("Enter");
  await remove.waitFor({ state: "hidden" });
  await row.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Installed plugins" }).and(page.locator(":focus")).waitFor();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  for (const name of ["imported-plugins", "imported-plugin-data", "skills"])
    assert.deepEqual(readdirSync(join(profile, name)), []);
  assert.deepEqual(await page.evaluate(async () => {
    const { composerId, settings } = await window.pi.getSnapshot();
    return [settings.pluginPromptTemplates, await window.pi.mcpList(), await window.pi.skillsList(composerId)];
  }), [[], [], []]);
  assert.ok(existsSync(join(fixture.root, "scripts", "fixture.cjs")));
}

function discoveryLabels(locale) {
  return locale === locales[1]
    ? {
        skills: "Skills", plugins: "Discover plugins", market: "Plugin marketplaces", backSkills: "Back to skills",
        source: "Official Claude Code marketplace", add: "Add marketplace", mcp: "MCP servers",
        discoverMcp: "Discover MCP servers", backMcp: "Back to MCP servers", query: "Search MCP servers by name",
        configure: "Configure MCP server", useConfig: "Use configuration",
      }
    : {
        skills: "技能", plugins: "发现插件", market: "插件市场", backSkills: "返回技能",
        source: "Claude Code 官方市场", add: "添加市场", mcp: "MCP 服务",
        discoverMcp: "发现 MCP 服务", backMcp: "返回 MCP 服务", query: "按名称搜索 MCP 服务",
        configure: "配置 MCP 服务", useConfig: "填入配置",
      };
}

function writeDiscoveryMarket(root) {
  execFileSync("git", ["init", "-q", "--template=", root]);
  const plugin = join(root, "plugins", "catalog-notes");
  const skill = join(plugin, "skills", "catalog-notes");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({
    name: "fixture-market", owner: { name: "Catalog owner" },
    plugins: [
      { name: "catalog-notes", displayName: "Catalog notes", description: "Notes fixture", author: { name: "Fixture author" },
        version: "1.2.0", source: "./plugins/catalog-notes" },
      { name: "catalog-npm", source: { source: "npm", package: "fixture-plugin" } },
    ],
  }));
  writeFileSync(join(plugin, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "catalog-notes", version: "1.2.0" }));
  writeFileSync(join(skill, "SKILL.md"), "---\nname: Catalog notes skill\n---\nReview notes.");
  execFileSync("git", ["-c", "core.autocrlf=false", "add", "--all"], { cwd: root });
  execFileSync("git", [
    "-c", "user.name=Pilot Desktop Test", "-c", "user.email=pilot@example.invalid", "-c", "commit.gpgSign=false",
    "commit", "-qm", "Add discovery marketplace fixture",
  ], { cwd: root });
}

async function mockDiscoveryRegistry(app) {
  await app.evaluate(({ session }) => {
    const partition = session.fromPartition("pilot-network", { cache: false });
    const original = partition.fetch.bind(partition);
    const receipts = { searches: [], connections: [] };
    globalThis.pilotDiscoveryReceipts = receipts;
    partition.fetch = async (request, options) => {
      const url = new URL(typeof request === "string" ? request : request.url ?? request.href);
      if (url.hostname.endsWith(".discovery.example.test")) {
        receipts.connections.push(url.href);
        return new Response(null, { status: 503 });
      }
      if (url.hostname !== "registry.modelcontextprotocol.io") return original(request, options);
      const query = url.searchParams.get("search");
      const cursor = url.searchParams.get("cursor");
      receipts.searches.push({ path: url.pathname, query, cursor, version: url.searchParams.get("version"),
        credentials: options.credentials });
      if (query === "broken") return new Response(null, { status: 503 });
      if (cursor === "next:1") return Response.json({
        servers: [{ server: { name: "io.github.Fixture/legacy", title: "Legacy fixture", version: "1.0.0",
          remotes: [{ type: "sse", url: "https://legacy.discovery.example.test/sse" }] } }],
      });
      return Response.json({
        servers: [
          { server: { name: "io.github.Fixture/http", title: "HTTP discovery fixture", description: "Fixture for review", version: "1.2.3",
            repository: { url: "https://github.com/Fixture/discovery" },
            remotes: [{ type: "streamable-http", url: "https://{tenant}.discovery.example.test/mcp",
              headers: [{ name: "Authorization", isRequired: true }] }] } },
          { server: { name: "io.github.Fixture/stdio", title: "Stdio discovery fixture", version: "2.0.0",
            packages: [{ registryType: "npm", identifier: "@fixture/discovery", version: "2.0.0",
              transport: { type: "stdio" }, environmentVariables: [{ name: "FIXTURE_MODE", default: "demo" }] }] } },
        ],
        metadata: { nextCursor: "next:1" },
      });
    };
  });
}

export async function verifyDiscovery(page, window, app, root) {
  writeDiscoveryMarket(root);
  await mockDiscoveryRegistry(app);
  const en = locales[1];
  let locale = locales[0];
  let contrast = Infinity;
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const next of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, locale, next, theme);
        locale = next;
        const labels = discoveryLabels(locale);
        await openSettings(page, locale, labels.skills);
        const discoverPlugins = button(page, labels.plugins);
        await discoverPlugins.press("Enter");
        const market = page.locator('[data-discovery="plugins"]');
        await market.getByRole("heading", { name: labels.market }).and(page.locator(":focus-visible")).waitFor();
        const source = market.locator("#plugin-marketplace-source");
        await source.getByText(labels.source, { exact: true }).waitFor();
        await source.scrollIntoViewIfNeeded();
        await assertFits(source);
        await source.press("Enter");
        const selected = page.getByRole("option", { name: labels.source, selected: true });
        await assertFits(selected);
        await page.keyboard.press("Escape");
        await source.and(page.locator(":focus")).waitFor();
        await button(market, labels.backSkills).press("Enter");
        await discoverPlugins.and(page.locator(":focus-visible")).waitFor();
        await page.keyboard.press("Control+l");

        await openSettings(page, locale, labels.mcp);
        const discoverMcp = button(page, labels.discoverMcp);
        await discoverMcp.press("Enter");
        const registry = page.locator('[data-discovery="mcp"]');
        await registry.getByRole("heading", { name: "MCP Registry" }).and(page.locator(":focus-visible")).waitFor();
        const query = registry.getByRole("searchbox", { name: labels.query });
        await query.scrollIntoViewIfNeeded();
        await assertFits(query);
        await query.fill("fixture");
        await query.press("Enter");
        const http = registry.locator('[data-registry-entry="io.github.Fixture/http"]');
        await button(http, labels.useConfig).press("Enter");
        const edit = page.getByRole("dialog", { name: labels.configure });
        await assertFits(edit);
        contrast = Math.min(contrast, await minimumTextContrast(edit, "h2, p, label"));
        await page.keyboard.press("Escape");
        await edit.waitFor({ state: "hidden" });
        await button(http, labels.useConfig).and(page.locator(":focus")).waitFor();
        await button(registry, labels.backMcp).press("Enter");
        await discoverMcp.and(page.locator(":focus-visible")).waitFor();
        await page.keyboard.press("Control+l");
        console.log("Checked discovery at " + size.width + " × " + size.height + " " +
          zoom * 100 + "% " + locale.lang + " " + theme);
      }
    }
  }
  assert.ok(contrast >= 4.5);
  console.log("MCP discovery review text minimum contrast " + contrast.toFixed(2) + ":1");
  await resize(page, window, wide);

  await openSettings(page, en, "Skills");
  await button(page, "Discover plugins").press("Enter");
  const market = page.locator('[data-discovery="plugins"]');
  const address = market.getByRole("textbox", { name: "Add a Git marketplace" });
  await address.fill("missing-marketplace");
  await address.press("Enter");
  await market.getByRole("alert").filter({ hasText: /Could not load the marketplace/ }).waitFor();
  await address.fill(root);
  await address.press("Enter");
  const plugin = market.locator('[data-marketplace-entry="catalog-notes"]');
  await plugin.getByText("By Fixture author · Version 1.2.0").waitFor();
  await plugin.getByText("plugins/catalog-notes", { exact: true }).waitFor();
  const blocked = market.locator('[data-marketplace-entry="catalog-npm"]');
  await blocked.getByText("Installation from this source is unavailable.").waitFor();
  const filter = market.getByRole("searchbox", { name: "Filter marketplace plugins" });
  await filter.fill("Fixture author");
  await blocked.waitFor({ state: "hidden" });
  await button(plugin, "Preview installation").press("Enter");
  const preview = page.getByRole("dialog", { name: "Install plugin" });
  await preview.getByText("Catalog notes skill", { exact: true }).waitFor();
  await preview.getByText("plugins/catalog-notes", { exact: true }).waitFor();
  await button(preview, "Confirm installation").press("Enter");
  await preview.waitFor({ state: "hidden" });
  await button(plugin, "Preview installation").and(page.locator(":focus")).waitFor();
  await button(market, "Back to skills").press("Enter");
  const skill = page.getByRole("switch", { name: "Catalog notes skill" });
  await skill.waitFor();
  assert.equal(await skill.getAttribute("aria-checked"), "false");
  await page.keyboard.press("Control+l");

  await openSettings(page, en, "MCP servers");
  await button(page, "Discover MCP servers").press("Enter");
  const registry = page.locator('[data-discovery="mcp"]');
  const query = registry.getByRole("searchbox", { name: "Search MCP servers by name" });
  await query.fill("ab");
  assert.ok(await button(registry, "Search").isDisabled());
  await query.fill("broken");
  await query.press("Enter");
  await registry.getByRole("alert").filter({ hasText: /Could not reach MCP Registry/ }).waitFor();
  await query.fill("fixture");
  await query.press("Enter");
  const http = registry.locator('[data-registry-entry="io.github.Fixture/http"]');
  await http.getByText("Publisher Fixture · Version 1.2.3").waitFor();
  await http.getByText("https://github.com/Fixture/discovery").waitFor();
  await button(registry, "Load more").press("Enter");
  await registry.getByText("No supported connection is available for this entry.").waitFor();
  await button(http, "Use configuration").press("Enter");
  const edit = page.getByRole("dialog", { name: "Configure MCP server" });
  const endpoint = edit.getByRole("textbox", { name: "URL", exact: true });
  assert.equal(await endpoint.inputValue(), "https://{tenant}.discovery.example.test/mcp");
  await button(edit, "Save").press("Enter");
  await edit.getByRole("alert").filter({ hasText: /required fields Authorization/ }).waitFor();
  await edit.getByRole("textbox", { name: "Request headers (JSON)" }).fill('{"Authorization":"Bearer fixture-token"}');
  await button(edit, "Save").press("Enter");
  await edit.getByRole("alert").filter({ hasText: /Replace the placeholders/ }).waitFor();
  await endpoint.fill("https://team.discovery.example.test/mcp");
  await button(edit, "Save").press("Enter");
  await edit.waitFor({ state: "hidden" });
  await registry.getByText("MCP configuration saved. Enable it from the server list.").waitFor();
  const stdio = registry.locator('[data-registry-entry="io.github.Fixture/stdio"]');
  await stdio.getByText('npx "--yes" "@fixture/discovery@2.0.0"', { exact: true }).waitFor();
  await button(stdio, "Use configuration").press("Enter");
  assert.equal(await edit.getByRole("textbox", { name: "Command", exact: true }).inputValue(), "npx");
  assert.equal(await edit.getByRole("textbox", { name: "Arguments (one per line)" }).inputValue(), "--yes\n@fixture/discovery@2.0.0");
  await button(edit, "Save").press("Enter");
  await edit.waitFor({ state: "hidden" });
  await button(registry, "Back to MCP servers").press("Enter");
  for (const name of ["HTTP discovery fixture", "Stdio discovery fixture"]) {
    const toggle = page.getByRole("switch", { name: "Enable " + name });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-checked"), "false");
  }
  const receipts = await app.evaluate(() => globalThis.pilotDiscoveryReceipts);
  assert.ok(receipts.searches.some(({ cursor, query }) => cursor === "next:1" && query === "fixture"));
  assert.ok(receipts.searches.every(({ path, version, credentials }) =>
    path === "/v0.1/servers" && version === "latest" && credentials === "omit"));
  assert.deepEqual(receipts.connections, []);
}

export async function verifyRestoredDiscovery(page) {
  const en = locales[1];
  await page.waitForFunction(() => document.documentElement.lang === "en");
  const servers = await page.evaluate(() => window.pi.mcpList());
  assert.deepEqual(servers.map(({ name, status, policy, transport }) => ({ name, status, policy, transport })), [
    { name: "HTTP discovery fixture", status: "disabled", policy: "confirm",
      transport: { type: "http", url: "https://team.discovery.example.test/mcp" } },
    { name: "Stdio discovery fixture", status: "disabled", policy: "confirm",
      transport: { type: "stdio", command: "npx", args: ["--yes", "@fixture/discovery@2.0.0"] } },
  ]);
  await openSettings(page, en, "Skills");
  await button(page, "Discover plugins").press("Enter");
  const market = page.locator('[data-discovery="plugins"]');
  const source = market.locator("#plugin-marketplace-source");
  await source.getByText("Official Claude Code marketplace", { exact: true }).waitFor();
  await source.press("Enter");
  await page.getByRole("option", { name: "fixture-market", exact: true }).press("Enter");
  await button(market, "Browse marketplace").press("Enter");
  await market.getByRole("heading", { name: "Catalog notes", exact: true }).waitFor();
  await button(market, "Remove source").press("Enter");
  await market.getByRole("heading", { name: "Catalog notes", exact: true }).waitFor({ state: "hidden" });
  const sources = await page.evaluate(() => window.pi.pluginMarketplaces());
  assert.equal(sources.length, 1);
  assert.match(sources[0].location, /anthropics\/claude-plugins-official/);
  await button(market, "Back to skills").press("Enter");
  await page.getByRole("switch", { name: "Catalog notes skill" }).waitFor();
}

export async function verifyCommandsAndTemplates(page, app, model, originalProject, project) {
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [folder] };
    };
  }, project);
  await choosePalette(page, "open-project", /^Open project…/);
  await waitForProjectDraft(page, project);
  await choosePalette(page, basename(originalProject), /^fixture-project/, "Projects");
  await waitForProjectDraft(page, originalProject);
  await choosePalette(page, basename(project), /^commands-project/, "Projects");
  await waitForProjectDraft(page, project);

  await choosePalette(page, "theme-light", /^Switch theme/);
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await choosePalette(page, "locale-zh", /^Switch language/);
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  await choosePalette(page, "locale-en", /^切换语言/);
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await choosePalette(page, "theme-dark", /^Switch theme/);
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));

  await choosePalette(page, "Prompt templates", /^Personalization/, "Settings");
  await page.waitForFunction(() => document.activeElement?.matches("[data-settings-heading]"));
  await button(page, "Add template").press("Enter");
  const create = page.getByRole("dialog", { name: "Add prompt template" });
  await assertFits(create);
  await create.getByRole("textbox", { name: "Command name" }).fill(templateName);
  await create.getByRole("textbox", { name: "Prompt text" }).fill(templateText);
  await button(create, "Save").press("Enter");
  await create.waitFor({ state: "hidden" });
  await page.getByText(templateCommand, { exact: true }).waitFor();
  await page.keyboard.press("Control+l");
  const initialCount = await page.locator("[data-session-id]").count();

  await chooseSlash(page, templateCommand);
  const parameters = page.getByRole("dialog", { name: "Fill template parameters" });
  await assertFits(parameters);
  await page.keyboard.press("Escape");
  await parameters.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
  assert.equal(await editor(page).innerText(), templateCommand);
  await editor(page).press("Enter");
  await parameters.getByRole("textbox", { name: "file", exact: true }).fill("main.ts");
  await parameters.getByRole("textbox", { name: "rule", exact: true }).fill("project policy");
  await button(parameters, "Insert into draft").press("Enter");
  await parameters.waitFor({ state: "hidden" });
  await page.waitForFunction(() =>
    document.querySelector("[data-composer-editor]")?.innerText ===
    "Check main.ts against project policy and summarize main.ts.",
  );
  await waitForProjectDraft(page, project);
  assert.equal(await page.locator("[data-session-id]").count(), initialCount);

  await choosePalette(page, templateCommand, /^audit-note/);
  await parameters.getByRole("textbox", { name: "file", exact: true }).fill("other.ts");
  await parameters.getByRole("textbox", { name: "rule", exact: true }).fill("second rule");
  await button(parameters, "Insert into draft").press("Enter");
  await page.waitForFunction(() => {
    const value = document.querySelector("[data-composer-editor]")?.innerText ?? "";
    return value.startsWith("Check main.ts") && value.endsWith("summarize other.ts.");
  });

  await chooseSlash(page, "/init");
  await page.waitForFunction(() => document.querySelector("[data-composer-editor]")?.innerText.includes("Create or update AGENTS.md"));
  const instructionsPath = join(project, "AGENTS.md");
  await waitForProjectDraft(page, project);
  assert.ok(!existsSync(instructionsPath));
  await editor(page).press("Enter");
  const init = await model.nextCompletion();
  assert.match(init.input.messages.at(-1).content, /Create or update AGENTS\.md/);
  sendTool(init, "command-init-write", "write_file", { path: "AGENTS.md", content: "# Project fixture\n" });
  const approval = page.locator("[data-permission-card]");
  await approval.getByText(instructionsPath, { exact: true }).waitFor();
  assert.ok(!existsSync(instructionsPath));
  await button(approval, "Allow once").click();
  const created = await model.nextCompletion();
  created.write({ content: "Created the command fixture instructions." });
  created.finish();
  await page.getByText("Created the command fixture instructions.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  assert.equal(readFileSync(instructionsPath, "utf8"), "# Project fixture\n");

  await chooseSlash(page, "/diff");
  await page.getByRole("tab", { name: /^Changes/, selected: true }).waitFor();
  await page.keyboard.press("Control+l");
  await chooseSlash(page, "/review");
  await page.waitForFunction(() => document.querySelector("[data-composer-editor]")?.innerText.includes("Review the uncommitted changes"));
  await editor(page).press("Enter");
  const review = await model.nextCompletion();
  assert.match(review.input.messages.at(-1).content, /including staged, unstaged, and untracked files/);
  review.write({ content: "The command fixture review is complete." });
  review.finish();
  await page.getByText("The command fixture review is complete.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();

  await send(page, "/compact retain the project decision");
  const compact = await model.nextCompletion();
  assert.match(JSON.stringify(compact.input.messages.at(-1).content), /retain the project decision/);
  compact.write({ content: "The workspace has a short AGENTS.md." });
  compact.finish();
  await page.locator("[data-context-compaction]").waitFor();
  await button(page, "Send").waitFor();

  await choosePalette(page, "verify-test", /^Run verification/);
  await page.getByRole("tab", { name: /^Verify/, selected: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("[data-verification-exit-code]")?.textContent === "0");
  const output = button(page.locator("[data-verification-detail]"), "Output");
  if (await output.getAttribute("aria-expanded") === "false") await output.click();
  await page.locator("[data-verification-output]").filter({ hasText: "123456789" }).waitFor();

  const active = page.locator('[data-session-id][aria-current="page"]');
  const sessionId = await active.getAttribute("data-session-id");
  await page.keyboard.press("Control+l");
  await chooseSlash(page, "/clear");
  await waitForProjectDraft(page, project);
  await active.waitFor({ state: "hidden" });
  assert.equal(await page.locator('[data-session-id="' + sessionId + '"]').count(), 1);
  assert.equal(await page.locator("[data-session-id]").count(), initialCount + 1);
}

export async function verifyRestoredPromptTemplates(page) {
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await editor(page).focus();
  const { settings } = await page.evaluate(() => window.pi.getSnapshot());
  assert.deepEqual(settings.promptTemplates, [{ name: templateName, text: templateText }]);
  await choosePalette(page, "Prompt templates", /^Personalization/, "Settings");
  await page.getByText(templateText, { exact: true }).waitFor();
  await button(page, "Edit " + templateCommand).press("Enter");
  const edit = page.getByRole("dialog", { name: "Edit prompt template" });
  await edit.getByRole("textbox", { name: "Prompt text" }).fill("Review {{file}}.");
  await button(edit, "Save").press("Enter");
  await page.getByText("Review {{file}}.", { exact: true }).waitFor();

  await button(page, "Delete " + templateCommand).press("Enter");
  const remove = page.getByRole("dialog", { name: "Delete prompt template?" });
  await button(remove, "Delete").press("Enter");
  await remove.waitFor({ state: "hidden" });
  await page.getByText(templateCommand, { exact: true }).waitFor({ state: "hidden" });
}

async function pasteImage(page, name, data) {
  await editor(page).evaluate((field, image) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.fromBase64(image.data)], image.name, { type: "image/png" }));
    field.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, { name, data });
}

async function dropLocalFiles(page, files, target = editor(page), onOver) {
  const inspector = await page.context().newCDPSession(page);
  try {
    const rect = await target.boundingBox();
    assert.ok(rect);
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver"])
      await inspector.send("Input.dispatchDragEvent", { type, ...point, data });
    await onOver?.();
    await inspector.send("Input.dispatchDragEvent", { type: "drop", ...point, data });
  } finally {
    await inspector.detach();
  }
}

export async function verifyWslProject(page, app, model, directory) {
  await page.evaluate(async ({ baseUrl, modelId }) => {
    await window.pi.settingsSave({
      providers: [{ id: "wsl", kind: "openai-compatible", name: "WSL fixture", baseUrl, modelId }],
      activeProviderId: "wsl",
    });
  }, { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.reload();
  await app.evaluate(({ dialog }, folder) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async (_window, options) => {
      dialog.showOpenDialog = original;
      if (!options.properties.includes("openDirectory") || !/^\\\\wsl\.localhost\\/i.test(options.defaultPath))
        throw new Error("Expected directory selection in a WSL distribution");
      return { canceled: false, filePaths: [folder] };
    };
  }, directory);
  await button(page, "应用菜单").press("Enter");
  await page.getByRole("menuitem", { name: "打开 WSL 项目…", exact: true }).click();
  await waitForProjectDraft(page, directory);
  await page.locator("main header").getByText(basename(directory), { exact: true }).waitFor();
  await editor(page).fill("Run a command in the selected WSL project.");
  await editor(page).press("Enter");
  const first = await model.nextCompletion();
  sendTool(first, "wsl-command", "bash", { command: "pwd; cat readme.txt" });
  const approval = page.locator("[data-permission-card]");
  await approval.getByText(/WSL · /).waitFor();
  await button(approval, "本次允许").press("Enter");
  const next = await model.nextCompletion();
  const output = next.input.messages.at(-1).content;
  const distribution = directory.split("\\")[3];
  const path = "/" + directory.split("\\").slice(4).join("/");
  assert.ok(output.includes(path));
  assert.ok(output.includes("wsl fixture"));
  next.write({ content: "The WSL project command finished." });
  next.finish();
  await waitForIdle(page);
  const { sessionId } = await page.evaluate(() => window.pi.getSnapshot());
  await page.reload();
  await page.getByText("The WSL project command finished.", { exact: true }).waitFor();
  const restored = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(restored.sessionId, sessionId);
  assert.equal(restored.sessions.find(({ id }) => id === sessionId)?.workingDirectory, directory);
  assert.ok(distribution && path.length > 1);
}

export async function verifyProjectEntry(page, window, app, fixture) {
  const { electron, repository, profile, caller, firstProject, secondProject } = fixture;
  const localFolder = join(firstProject, "reference-folder");
  const plainFile = join(caller, "not-a-project.txt");
  mkdirSync(localFolder);
  writeFileSync(plainFile, "A file is not a project folder.");
  const draft = "Keep this project draft.";
  async function waitForSnapshot(matches, description) {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const snapshot = await page.evaluate(() => window.pi.getSnapshot());
      if (matches(snapshot)) return snapshot;
      await delay(75);
    }
    throw new Error("Timed out waiting for " + description);
  }
  const waitForDirectory = directory => waitForSnapshot(
    snapshot => !snapshot.sessionId && snapshot.draftWorkingDirectory === directory,
    basename(directory),
  );
  await waitForDirectory(firstProject);
  await page.locator("main header").getByText(basename(firstProject), { exact: true }).waitFor();
  await editor(page).fill(draft);
  const first = await waitForSnapshot(snapshot =>
    snapshot.draftWorkingDirectory === firstProject && snapshot.composerDraft.join("") === draft,
    "the saved project draft",
  );

  async function launchAgain(...args) {
    const process = spawn(electron, [repository, "--user-data-dir=" + profile, ...args], {
      cwd: caller, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    process.stdout.on("data", chunk => output += chunk.toString());
    process.stderr.on("data", chunk => output += chunk.toString());
    try {
      const [code] = await once(process, "close", { signal: AbortSignal.timeout(10000) });
      assert.equal(code, 0, output);
      assert.doesNotMatch(output, /\[renderer\] \[app\] mounted/);
    } finally {
      stopProcessTree(process);
    }
  }

  const windowId = await window.evaluate(win => { win.minimize(); return win.id; });
  await launchAgain(basename(secondProject));
  await waitForDirectory(secondProject);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map(win => [win.id, win.isMinimized()]),
  ), [[windowId, false]]);
  await app.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox;
    globalThis.__pilotProjectEntryTestMessage = new Promise(resolve => {
      dialog.showMessageBox = async (_window, options) => {
        dialog.showMessageBox = original;
        resolve(options.message);
        return { response: 0, checkboxChecked: false };
      };
    });
  });
  await launchAgain("--open-project", "missing test folder");
  assert.equal(await app.evaluate(() => globalThis.__pilotProjectEntryTestMessage), "Could not open the project");
  await waitForDirectory(secondProject);

  let current = locales[1];
  const target = page.locator("main header").first();
  for (const [size, zoom] of [[wide, 1], [narrow, 1], [narrow, 1.5]]) {
    await resize(page, window, size, zoom);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await dropLocalFiles(page, [secondProject], target, async () => {
          const hint = page.getByText(locale === locales[1] ? "Drop a folder to open a project" : "拖入文件夹以打开项目", { exact: true });
          await assertFits(hint);
        });
        await page.locator("[data-project-drop-hint]").waitFor({ state: "hidden" });
        await waitForDirectory(secondProject);
        await editor(page).and(page.locator(":focus")).waitFor();
      }
    }
  }
  await dropLocalFiles(page, [plainFile], target);
  await page.locator("[data-feedback-bar]").getByText("Could not open the project. Drop a folder or use Open project.", { exact: true }).waitFor();
  await waitForDirectory(secondProject);
  await dropLocalFiles(page, [firstProject], target);
  const restored = await waitForDirectory(firstProject);
  assert.equal(restored.composerId, first.composerId);
  assert.equal(restored.composerDraft.join(""), draft);
  await page.waitForFunction(text => document.querySelector("[data-composer-editor]")?.innerText === text, draft);
  await dropLocalFiles(page, [localFolder]);
  await editor(page).getByText(basename(localFolder), { exact: true }).waitFor();
  await launchAgain("--open-project", firstProject + "\\.");
  const currentDraft = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(currentDraft.composerId, first.composerId);
  assert.equal(currentDraft.sessions.length, first.sessions.length);
  assert.ok(currentDraft.recentProjects.includes(firstProject) && currentDraft.recentProjects.includes(secondProject));
}

export async function verifyImageDraft(page, window, model, project, files) {
  await page.keyboard.press("Control+l");
  await editor(page).waitFor();
  await page.evaluate(async ({ project, modelId, visionModelId }) => {
    const snapshot = await window.pi.getSnapshot();
    const providers = snapshot.settings.providers.map(({ id, kind, name, baseUrl, modelId: selected, models }) => ({
      id, kind, name, baseUrl, modelId: selected,
      models: models.map(({ automatic: _automatic, ...entry }) => entry),
    }));
    const provider = providers.find(({ id }) => id === snapshot.settings.activeProviderId);
    provider.models = [
      { id: modelId, name: "Pilot text fixture", overrides: { supportsImages: false, supportsThinking: false } },
      { id: visionModelId, name: "Pilot vision fixture", overrides: { supportsImages: true, supportsThinking: false } },
    ];
    await window.pi.settingsSave({ providers, activeProviderId: provider.id });
    await window.pi.sessionUseRecentProject(project);
  }, { project, modelId: model.modelId, visionModelId: model.visionModelId });
  await waitForProjectDraft(page, project);
  const before = (await page.evaluate(() => window.pi.getSnapshot())).sessions.length;

  await button(page, "Reference files and folders").press("Enter");
  const picker = page.getByRole("dialog", { name: "Reference files and folders" });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    button(picker, "Choose images…").press("Enter"),
  ]);
  await chooser.setFiles(files.chosen);
  await button(page, "View image chosen.png").waitFor();
  const data = readFileSync(files.chosen, "base64");
  await pasteImage(page, "pasted.png", data);
  await button(page, "View image pasted.png").waitFor();
  await dropLocalFiles(page, [files.dropped, files.reference, files.outside]);
  await button(page, "View image dropped.png").waitFor();
  await editor(page).locator("[data-mention]").getByText("image-context.txt", { exact: true }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Some files could not be referenced" }).waitFor();
  assert.equal(await editor(page).locator("[data-mention]").count(), 1);

  const sendButton = button(page, "Send");
  await page.getByText(/This model accepts text only/).waitFor();
  assert.equal(await sendButton.isDisabled(), true);
  await button(page, "Remove image pasted.png").press("Enter");
  await button(page, "View image pasted.png").waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));

  let current = locales[1];
  for (const size of [wide, narrow]) {
    await resize(page, window, size);
    for (const locale of locales) {
      for (const theme of ["light", "dark"]) {
        await selectAppearance(page, current, locale, theme);
        current = locale;
        await assertFits(page.locator('[data-slot="attachment-group"]'));
        await assertFits(editor(page));
        console.log("Checked attachment layout at " + size.width + " × " + size.height + " " + locale.lang + " " + theme);
      }
    }
  }
  await resize(page, window, narrow, 1.5);
  const previewButton = button(page, "View image chosen.png");
  await previewButton.press("Enter");
  const preview = page.getByRole("dialog", { name: "chosen.png", exact: true });
  await assertFits(preview);
  await assertFits(preview.locator("[data-image-preview]"));
  await page.keyboard.press("Escape");
  await preview.waitFor({ state: "hidden" });
  assert.equal(await previewButton.evaluate((element) => element === document.activeElement), true);
  await resize(page, window, wide);

  const snapshot = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(snapshot.sessionId, null);
  assert.equal(snapshot.sessions.length, before);
  assert.deepEqual(snapshot.draftImages.map(({ name }) => name), ["chosen.png", "dropped.png"]);
}

export async function verifyImageConversation(page, model, project) {
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await editor(page).focus();
  await waitForProjectDraft(page, project);
  await button(page, "View image chosen.png").waitFor();
  await button(page, "View image dropped.png").waitFor();
  await editor(page).locator("[data-mention]").getByText("image-context.txt", { exact: true }).waitFor();
  const selected = await page.evaluate(() => window.pi.getSnapshot());
  await assert.rejects(
    page.evaluate(({ snapshot, project }) =>
      window.pi.agentPrompt({ text: "", mentions: [], images: snapshot.draftImages }, project, snapshot.composerId),
    { snapshot: selected, project }),
    /当前模型仅支持文本/,
  );
  await waitForProjectDraft(page, project);
  const warning = page.getByRole("status").filter({ hasText: "This model accepts text only" });
  await button(warning, "Choose a model").press("Enter");
  const models = page.getByRole("toolbar", { name: "Choose a model" });
  const vision = button(models, /^Pilot vision fixture/);
  await vision.getByText("Supports image input", { exact: true }).waitFor();
  await vision.press("Enter");
  await warning.waitFor({ state: "hidden" });
  await models.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-popup-open][aria-label="Choose a model"]'));
  await editor(page).click();
  await editor(page).press("Control+End");
  await page.keyboard.insertText(" Compare the images.");
  await page.waitForFunction(() => document.querySelector("[data-composer-editor]")?.innerText.includes("Compare the images."));
  await button(page, "Send").press("Enter");
  const multimodal = await model.nextCompletion();
  assert.equal(multimodal.input.model, model.visionModelId);
  const content = multimodal.input.messages.at(-1).content;
  assert.ok(Array.isArray(content));
  const text = content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n");
  assert.match(text, /Compare the images/);
  assert.match(text, /Selected mentions[\s\S]*image-context\.txt/);
  const images = content.filter(({ type }) => type === "image_url");
  assert.deepEqual(images.map(({ image_url }) => image_url.url), selected.draftImages.map(({ data }) => "data:image/png;base64," + data));
  multimodal.write({ content: "The fixture received two images and the project reference." });
  multimodal.finish();
  await page.getByText("The fixture received two images and the project reference.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();

  await pasteImage(page, "image-only.png", selected.draftImages[0].data);
  await button(page, "View image image-only.png").waitFor();
  assert.equal(await editor(page).innerText(), "");
  await button(page, "Send").press("Enter");
  const imageOnly = await model.nextCompletion();
  assert.equal(imageOnly.input.messages.at(-1).content.filter(({ type }) => type === "image_url").length, 1);
  imageOnly.write({ content: "The fixture received an image-only message." });
  imageOnly.finish();
  await page.getByText("The fixture received an image-only message.", { exact: true }).waitFor();
  await button(page, "Send").waitFor();
  const saved = await page.evaluate(() => window.pi.getSnapshot());
  assert.ok(saved.sessionId);
  assert.deepEqual(saved.draftImages, []);
  await page.keyboard.press("Control+n");
  await waitForProjectDraft(page, project);
  await page.evaluate((id) => window.pi.sessionLoad(id), saved.sessionId);
  await button(page, "View image image-only.png").press("Enter");
  const reopened = page.getByRole("dialog", { name: "image-only.png", exact: true });
  await reopened.locator("[data-image-preview]").waitFor();
  assert.equal(await reopened.locator("[data-image-preview]").evaluate((img) => img.complete && img.naturalWidth > 0), true);
  await page.keyboard.press("Escape");
  await reopened.waitFor({ state: "hidden" });

  await pasteImage(page, "keep-in-draft.png", selected.draftImages[0].data);
  await button(page, "View image keep-in-draft.png").waitFor();
  await chooseSlash(page, "/model");
  const textModel = button(models, /^Use global default/);
  await textModel.getByText("Text input only", { exact: true }).waitFor();
  await textModel.press("Enter");
  await page.waitForFunction(async () => {
    const snapshot = await window.pi.getSnapshot();
    return !snapshot.sessions.find(({ id }) => id === snapshot.sessionId)?.model;
  });
  await warning.waitFor();
  await models.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[data-popup-open][aria-label="Choose a model"]'));
  await button(page, "View image keep-in-draft.png").waitFor();
  assert.equal(await button(page, "Send").isDisabled(), true);
  await button(page, "Remove image keep-in-draft.png").press("Enter");
  await warning.waitFor({ state: "hidden" });
  await send(page, "Continue in text.");
  const continuation = await model.nextCompletion();
  assert.equal(continuation.input.model, model.modelId);
  assert.doesNotMatch(JSON.stringify(continuation.input.messages), /data:image\//);
  continuation.write({ content: "The fixture continued in text." });
  continuation.finish();
  await page.getByText("The fixture continued in text.", { exact: true }).waitFor();
  await button(page, "View image image-only.png").waitFor();
  await button(page, "Send").waitFor();
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRuns.length === 0);
}
