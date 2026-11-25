// @env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

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
    name: "中文",
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

function sendTool(completion, id, name, args) {
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
  completion.finish("tool_calls");
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
  const control = page.locator("#command-shell");
  const selected = await control.innerText();
  if (selected !== shell) {
    await control.click();
    await page.getByRole("option", { name: shell, exact: true }).click();
    const save = button(page.getByRole("main"), "Save");
    await save.click();
    await page.getByRole("main").getByText("Saved", { exact: true }).waitFor();
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
    const context = document.createElement("canvas").getContext("2d");
    const luminance = (color) => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgb = context.getImageData(0, 0, 1, 1).data.slice(0, 3);
      return [0.2126, 0.7152, 0.0722].reduce((total, weight, index) => {
        const value = rgb[index] / 255;
        const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        return total + weight * linear;
      }, 0);
    };
    const background = luminance(getComputedStyle(element).backgroundColor);
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

async function dropLocalFiles(page, files) {
  const inspector = await page.context().newCDPSession(page);
  try {
    const rect = await editor(page).boundingBox();
    assert.ok(rect);
    const point = { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ["dragEnter", "dragOver", "drop"])
      await inspector.send("Input.dispatchDragEvent", { type, ...point, data });
  } finally {
    await inspector.detach();
  }
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
  await page.waitForFunction(async () => (await window.pi.getSnapshot()).activeRun === null);
}
