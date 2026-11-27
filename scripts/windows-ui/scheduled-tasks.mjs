// @env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function button(scope, name) {
  return scope.getByRole("button", { name, exact: true });
}

async function waitForRun(page, trigger, status, timeout = 15_000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const [task] = await page.evaluate(() => window.pi.scheduledTasksList());
    const latest = task?.runs[0];
    if (latest?.trigger === trigger && latest.status === status) return;
    if (latest?.trigger === trigger && ["failed", "missed", "interrupted"].includes(latest.status))
      throw new Error("Unexpected scheduled run result " + JSON.stringify(latest));
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${trigger} execution to become ${status}`);
}

async function openTasks(page) {
  await button(page, "设置").click();
  await button(page.getByRole("navigation", { name: "设置", exact: true }), "定时任务").press("Enter");
  await page.getByRole("heading", { name: "定时任务", exact: true }).waitFor();
}

export async function verifyScheduledTasks(page, app, model, directory) {
  await page.evaluate(({ baseUrl, modelId }) => window.pi.settingsSave({
    providers: [{ id: "schedule", kind: "openai-compatible", name: "Schedule fixture", baseUrl, modelId }],
    activeProviderId: "schedule", approvalMode: "full-access",
  }), { baseUrl: model.baseUrl, modelId: model.modelId });
  await page.evaluate(() => window.pi.settingsSetNotificationsEnabled(false));
  await openTasks(page);
  const create = button(page, "创建任务…");
  await create.and(page.locator(":enabled")).waitFor();
  await create.press("Enter");
  const dialog = page.getByRole("dialog", { name: "创建定时任务" });
  await dialog.getByLabel("任务名称").fill("Check project on schedule");
  await dialog.getByLabel("任务提示词").fill("Summarize the workspace.");
  await app.evaluate(({ dialog: nativeDialog }, folder) => {
    const previous = nativeDialog.showOpenDialog;
    nativeDialog.showOpenDialog = async () => {
      nativeDialog.showOpenDialog = previous;
      return { canceled: false, filePaths: [folder] };
    };
  }, directory);
  await button(dialog, "选择目录…").press("Enter");
  await dialog.getByText(directory, { exact: true }).waitFor();
  const at = (Math.floor(Date.now() / 60_000) + (Date.now() % 60_000 > 50_000 ? 2 : 1)) * 60_000;
  await dialog.getByLabel("开始时间").fill(new Date(at).toISOString().slice(0, 16));
  await dialog.getByLabel("时区").fill("UTC");
  await dialog.getByText(/^下次执行 /).waitFor();
  await button(dialog, "保存").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await create.and(page.locator(":focus")).waitFor();

  const tasks = () => page.evaluate(() => window.pi.scheduledTasksList());
  const [{ id }] = await tasks();
  assert.equal((await tasks())[0].nextAt, at);
  const snapshotBefore = await page.evaluate(() => window.pi.getSnapshot());
  await button(page, "立即运行").press("Enter");
  const manual = await model.nextCompletion();
  assert.deepEqual(manual.input.tools.map(({ function: tool }) => tool.name).sort(), ["glob", "grep", "read_file"]);
  await assert.rejects(page.evaluate((id) => window.pi.scheduledTasksRun(id), id), /正在运行/);
  manual.write({ content: "Manual scheduled chat result." });
  manual.finish();
  await page.getByText("执行记录", { exact: true }).press("Enter");
  await page.getByText("已完成", { exact: true }).waitFor();
  const snapshotAfter = await page.evaluate(() => window.pi.getSnapshot());
  assert.equal(snapshotAfter.sessionId, snapshotBefore.sessionId);
  assert.equal(snapshotAfter.composerId, snapshotBefore.composerId);

  await waitForRun(page, "schedule", "running", 80_000);
  const scheduled = await model.nextCompletion();
  scheduled.write({ content: "On-time scheduled chat result." });
  scheduled.finish();
  await waitForRun(page, "schedule", "success");
  const task = (await tasks())[0];
  assert.equal(task.nextAt, null);
  assert.deepEqual(task.runs.map(({ status, trigger }) => [status, trigger]), [["success", "schedule"], ["success", "manual"]]);
  assert.notEqual(task.runs[0].sessionId, task.runs[1].sessionId);
  const scheduledEntry = page.getByRole("listitem").filter({ hasText: "定时执行" });
  await button(scheduledEntry, "打开会话").press("Enter");
  await page.getByText("On-time scheduled chat result.", { exact: true }).waitFor();

  await openTasks(page);
  await button(page, "暂停").press("Enter");
  const resume = button(page, "恢复调度");
  await resume.and(page.locator(":enabled")).waitFor();
  assert.equal((await tasks())[0].paused, true);
  await resume.press("Enter");
  await button(page, "暂停").and(page.locator(":enabled")).waitFor();
  assert.equal((await tasks())[0].paused, false);
  await button(page, "编辑…").press("Enter");
  const edit = page.getByRole("dialog", { name: "编辑定时任务" });
  await edit.getByLabel("任务名称").fill("Check project again");
  await button(edit, "保存").press("Enter");
  await page.getByRole("heading", { name: "Check project again" }).waitFor();
}

export function seedScheduleRecovery(profile) {
  const store = join(profile, "scheduled-tasks.json");
  const saved = JSON.parse(readFileSync(store, "utf8"));
  const task = saved.tasks[0];
  task.nextAt = (Math.floor(Date.now() / 60_000) - 1) * 60_000;
  task.start = new Date(task.nextAt).toISOString().slice(0, 16);
  task.runs.unshift({ id: randomUUID(), at: Date.now() - 120_000, trigger: "manual", status: "running", sessionId: randomUUID() });
  writeFileSync(store, JSON.stringify(saved));
}

export async function verifyRecoveredSchedules(page, model) {
  await openTasks(page);
  await page.getByText("执行记录", { exact: true }).press("Enter");
  await page.getByText("已错过", { exact: true }).waitFor();
  await page.getByText("已中断", { exact: true }).waitFor();
  await button(page, "重跑").first().press("Enter");
  const rerun = await model.nextCompletion();
  rerun.write({ content: "Recovered scheduled chat result." });
  rerun.finish();
  await waitForRun(page, "retry", "success");
  await button(page, "删除…").and(page.locator(":enabled")).press("Enter");
  const dialog = page.getByRole("dialog", { name: "删除定时任务？" });
  await button(dialog, "删除").press("Enter");
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.pi.scheduledTasksList()), []);
  await button(page, "创建任务…").and(page.locator(":focus")).waitFor();
}
