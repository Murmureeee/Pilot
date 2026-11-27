// @env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withDesktop } from "./windows-ui/desktop.mjs";

const sessionId = "a31bce54-422b-4dc0-9c99-aa53d44d984f";
const sizeOptions = [[1100, 750], [720, 480]];

function seedUsage(profile, project) {
  const sessions = join(profile, "sessions");
  mkdirSync(sessions, { recursive: true });
  mkdirSync(project);
  const timestamp = new Date(2026, 10, 27, 12).getTime();
  writeFileSync(join(sessions, "index.json"), JSON.stringify({
    sessions: [{ id: sessionId, title: "Usage fixture", workingDirectory: project, createdAt: timestamp, updatedAt: timestamp }],
  }));
  writeFileSync(join(sessions, sessionId + ".jsonl"), [
    { role: "user", content: "Usage fixture", timestamp },
    {
      role: "assistant", content: [{ type: "text", text: "Done" }], timestamp,
      api: "openai-completions", provider: "usage-provider", model: "usage-model",
      stopReason: "stop",
      usage: {
        input: 1000, output: 100, cacheRead: 20, cacheWrite: 3, totalTokens: 1123,
        cost: { input: 0.02, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.03 },
      },
    },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

async function setSize(page, window, width, height) {
  await window.evaluate((win, size) => win.setContentSize(...size), [width, height]);
  await page.waitForFunction(([expectedWidth, expectedHeight]) =>
    Math.abs(window.innerWidth - expectedWidth) < 5 &&
    Math.abs(window.innerHeight - expectedHeight) < 5, [width, height]);
}

async function assertVisibleWithinViewport(locator) {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0);
  const width = await locator.evaluate(() => window.innerWidth);
  assert.ok(bounds.x + bounds.width <= width + 1);
}

async function verifyUsage(profile, project) {
  seedUsage(profile, project);
  await withDesktop(profile, async (page, window) => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "用量统计", exact: true }).click();
    await page.getByText("总计 1,123 token", { exact: true }).waitFor();
    const report = await page.evaluate(() => window.pi.settingsUsageReport());
    assert.deepEqual(report.total, { input: 1000, output: 100, cacheRead: 20, cacheWrite: 3, costTotal: 0.03 });
    assert.equal(report.days[0]?.key, "2026-11-27");
    assert.equal(report.projects[0]?.description.toLowerCase(), project.toLowerCase());
    assert.equal(report.models[0]?.description, "usage-provider");

    const group = page.getByRole("combobox", { name: "用量统计分组" });
    for (const [width, height] of sizeOptions) {
      await setSize(page, window, width, height);
      await assertVisibleWithinViewport(group);
      await group.press("Enter");
      await page.getByRole("option", { name: "按项目", exact: true }).press("Enter");
      await page.getByText(project, { exact: true }).waitFor();
      await group.press("Enter");
      await page.getByRole("option", { name: "按模型", exact: true }).press("Enter");
      await page.getByText("usage-model", { exact: true }).waitFor();
      await assertVisibleWithinViewport(page.getByRole("button", { name: "刷新", exact: true }));
    }
  });
}

function sendWindowsShortcut(handle) {
  const script = [
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class PilotFixtureHotkey {",
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);',
    "}",
    "'@",
    `if ([PilotFixtureHotkey]::GetForegroundWindow().ToInt64().ToString() -ne '${handle}') { exit 42 }`,
    "$pressed = @(0x11, 0x10, 0x20)",
    "try {",
    "  foreach ($key in $pressed) { [PilotFixtureHotkey]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }",
    "} finally {",
    "  for ($index = $pressed.Count - 1; $index -ge 0; $index--) {",
    "    [PilotFixtureHotkey]::keybd_event($pressed[$index], 0, 2, [UIntPtr]::Zero)",
    "  }",
    "}",
  ].join("\n");
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, stdio: "pipe", timeout: 10_000,
    });
    return true;
  } catch (error) {
    if (error.status === 42) return false;
    throw error;
  }
}

async function verifyTray(profile) {
  await withDesktop(profile, async (page, window, app) => {
    await page.locator("[data-composer-editor]").waitFor();
    await page.keyboard.press("Control+,");
    await page.getByRole("heading", { name: "常规" }).waitFor();
    const trayToggle = page.getByRole("switch", { name: "关闭窗口时留在托盘" });
    const shortcutToggle = page.getByRole("switch", { name: "全局快捷键" });
    await trayToggle.click();
    await page.waitForFunction(async () => (await window.pi.settingsDesktopBackground()).trayActive);

    await app.evaluate(({ globalShortcut }) => {
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (key, callback) => {
        globalShortcut.register = register;
        globalThis.pilotFixtureShortcut = callback;
        return register(key, callback);
      };
    });
    await shortcutToggle.click();
    await page.waitForFunction(async () => (await window.pi.settingsDesktopBackground()).shortcutActive);
    const hidden = window.evaluate((win) => {
      win.close();
      return !win.isVisible() && !win.isDestroyed();
    });
    assert.equal(await hidden, true);

    const handle = await app.evaluate(({ BrowserWindow }) => {
      const fixture = new BrowserWindow({ width: 400, height: 300, title: "Pilot shortcut focus fixture" });
      globalThis.pilotFixtureWindow = fixture;
      fixture.focus();
      return fixture.getNativeWindowHandle().readBigUInt64LE().toString();
    });
    assert.match(handle, /^\d+$/);
    if (sendWindowsShortcut(handle)) {
      console.log("Registered native Windows global shortcut sent from fixture window");
    } else {
      console.log("SKIP native hotkey input: Windows did not grant foreground to the fixture; checking registered callback");
      await app.evaluate(() => globalThis.pilotFixtureShortcut());
    }
    await page.waitForFunction(() => document.activeElement?.matches("[data-composer-editor]"));
    assert.equal(await window.evaluate((win) => win.isVisible()), true);
    await app.evaluate(() => globalThis.pilotFixtureWindow.destroy());

    await page.keyboard.press("Control+,");
    await page.getByRole("heading", { name: "常规" }).waitFor();
    await shortcutToggle.click();
    await page.waitForFunction(async () => !(await window.pi.settingsDesktopBackground()).shortcutActive);
    assert.equal(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered("CommandOrControl+Shift+Space")), false);
  });
  await withDesktop(profile, async (page, window) => {
    const state = await page.evaluate(() => window.pi.settingsDesktopBackground());
    assert.equal(state.trayActive, true);
    assert.equal(state.shortcutActive, false);
    await page.evaluate(() => window.pi.settingsSetDesktopBackground("closeToTray", false));
    assert.equal(await window.evaluate((win) => win.isVisible()), true);
  });
}

async function verifyTraditionalChinese(profile) {
  await withDesktop(profile, async (page, window, app) => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "外观", exact: true }).click();
    const selector = page.locator("#settings-language");
    await selector.press("Enter");
    await page.getByRole("option", { name: "繁體中文", exact: true }).press("Enter");
    await page.waitForFunction(() => document.documentElement.lang === "zh-TW");
    await page.getByRole("searchbox", { name: "搜尋設定" }).waitFor();

    for (const [width, height] of sizeOptions) {
      await setSize(page, window, width, height);
      for (const theme of ["亮色", "暗色"]) {
        const button = page.getByRole("button", { name: theme, exact: true });
        await button.press("Enter");
        await assertVisibleWithinViewport(button);
        await assertVisibleWithinViewport(selector);
        console.log("Checked Traditional Chinese " + width + " × " + height + " " + theme);
      }
    }
    await app.evaluate(({ dialog }) => {
      const show = dialog.showOpenDialog;
      dialog.showOpenDialog = async (...args) => {
        dialog.showOpenDialog = show;
        globalThis.pilotFixturePickerTitle = args.at(-1)?.title;
        return { canceled: true, filePaths: [] };
      };
    });
    await page.keyboard.press("Control+o");
    await page.getByRole("heading", { name: "外觀", exact: true }).waitFor();
    assert.equal(await app.evaluate(() => globalThis.pilotFixturePickerTitle), "開啟專案");
  });
  await withDesktop(profile, async (page) => {
    await page.waitForFunction(() => document.documentElement.lang === "zh-TW");
    await page.keyboard.press("Control+,");
    await page.getByRole("searchbox", { name: "搜尋設定" }).waitFor();
  });
}

if (process.platform !== "win32") throw new Error("These Pilot desktop scenes require Windows");
const testTemporaryDirectory = realpathSync.native(tmpdir());
const root = realpathSync.native(mkdtempSync(join(testTemporaryDirectory, "pilot-m9-desktop-")));
try {
  const usageProfile = join(root, "usage");
  const trayProfile = join(root, "tray");
  const localeProfile = join(root, "locale");
  mkdirSync(trayProfile);
  mkdirSync(localeProfile);
  await verifyUsage(usageProfile, join(root, "Usage project"));
  console.log("PASS persisted usage, local-day/project/model grouping and keyboard");
  await verifyTray(trayProfile);
  console.log("PASS tray close, shortcut focus, explicit quit and restart preferences");
  await verifyTraditionalChinese(localeProfile);
  console.log("PASS Traditional Chinese theme and viewport checks, primary language and native picker copy");
} finally {
  assert.equal(root.startsWith(join(testTemporaryDirectory, "pilot-m9-desktop-")), true);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  assert.equal(existsSync(root), false);
  console.log("Removed Pilot milestone 9 desktop fixture profiles");
}
