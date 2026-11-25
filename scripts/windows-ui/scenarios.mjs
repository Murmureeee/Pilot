// @env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

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

const locales = [
  {
    lang: "zh-CN",
    name: "中文",
    settings: "设置",
    appearance: "外观",
    theme: "主题",
    light: "亮色",
    dark: "暗色",
    tabs: ["变更", "文件", "验证"],
    back: "返回对话",
  },
  {
    lang: "en",
    name: "English",
    settings: "Settings",
    appearance: "Appearance",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    tabs: ["Changes", "Files", "Verify"],
    back: "Back to chat",
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
  await send(page, streamPrompt);
  const reply = await model.nextCompletion();
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

async function selectAppearance(page, current, locale, theme) {
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
  await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
}

async function verifyReviewLayout(page, locale, overlay) {
  const trigger = page.locator("#review-trigger");
  await trigger.click();
  const review = page.locator("[data-review-layout]");
  await review.waitFor();
  assert.equal(await review.getAttribute("data-review-layout"), overlay ? "overlay" : "split");
  assert.equal(await page.locator("main").evaluate((node) => node.inert), overlay);
  const [changes, files, validation] = locale.tabs;
  await assertFits(review.getByRole("tab", { name: new RegExp("^" + changes) }));
  await assertFits(review.getByRole("tab", { name: files, exact: true }));
  await assertFits(review.getByRole("tab", { name: validation, exact: true }));
  if (overlay) await assertFits(button(review, locale.back));
  await page.waitForFunction(() =>
    document.activeElement?.matches('[role="tab"][aria-selected="true"]'),
  );
  await page.keyboard.press("Escape");
  await review.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.id === "review-trigger");
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
        console.log(
          "Checked " + size.width + " × " + size.height + " " + locale.lang + " " + theme,
        );
      }
    }
  }

  await resize(page, window, narrow, 1.5);
  await verifyReviewLayout(page, current, true);
  await page.keyboard.press("Control+Shift+s");
  await page.waitForFunction(() => document.querySelector("main")?.inert);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "sidebar-toggle");
  await page.keyboard.press("Control+l");
  await assertFits(editor(page));
  await resize(page, window, wide);
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
