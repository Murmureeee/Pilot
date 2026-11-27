// @env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

import { repository, withDesktop } from "./windows-ui/desktop.mjs";
import { startModelFixture } from "./windows-ui/model.mjs";

const coldRuns = 3;
const deltaCount = 120;
const messageCount = 500;
const scrollFrames = 180;
const switches = 60;
const coldLimitMs = 3_000;
const deltaLimitMs = 100;
const viewport = '[data-slot="message-scroller-viewport"]';
const message = '[data-slot="message-scroller-item"]';
const chatIds = ["86a75b0d-45a9-440c-8d88-87e50cf125ff", "dbb7aba6-3369-4e5c-87b8-13f9de0e32a1"];

function seed(profile, model) {
  const sessions = join(profile, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(
    join(profile, "settings.json"),
    JSON.stringify({
      formatVersion: 1,
      providers: [
        {
          id: "benchmark",
          kind: "openai-compatible",
          name: "Loopback benchmark",
          modelId: model.modelId,
          baseUrl: model.baseUrl,
        },
      ],
      activeProviderId: "benchmark",
      thinkingLevel: "off",
      notificationsEnabled: false,
    }),
  );
  writeFileSync(
    join(sessions, "index.json"),
    JSON.stringify({
      formatVersion: 1,
      sessions: chatIds.map((id, index) => ({
        id,
        title: "Benchmark conversation " + index,
        createdAt: index + 1,
        updatedAt: index + 1,
      })),
    }),
  );
  for (const [chat, id] of chatIds.entries()) {
    const records = [{ type: "pilot_transcript", formatVersion: 1 }];
    for (let index = 0; index < messageCount; index++) {
      const user = index % 2 === 0;
      const label = "Fixture " + chat + " message " + index;
      records.push({
        role: user ? "user" : "assistant",
        content: user
          ? label + " asks about the selected project."
          : [
              {
                type: "text",
                text:
                  label +
                  " describes the response.\n\n- Review **the selected files**.\n- Record the test result.",
              },
            ],
        timestamp: index + 1,
      });
    }
    writeFileSync(
      join(sessions, id + ".jsonl"),
      records.map((row) => JSON.stringify(row)).join("\n") + "\n",
    );
  }
}

function percentile(values, p) {
  return [...values].sort((left, right) => left - right)[Math.ceil(p * values.length) - 1];
}

function summarize(samples) {
  return {
    count: samples.length,
    medianMs: Math.round(percentile(samples, 0.5) * 10) / 10,
    p95Ms: Math.round(percentile(samples, 0.95) * 10) / 10,
    maxMs: Math.round(Math.max(...samples) * 10) / 10,
  };
}

async function readyAt(page) {
  const editor = page.locator('[data-composer-editor][contenteditable="true"]');
  await editor.waitFor();
  await editor.focus();
  const timestamp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (
              !document.activeElement?.matches('[data-composer-editor][contenteditable="true"]')
            ) {
              resolve(null);
              return;
            }
            resolve(performance.timeOrigin + performance.now());
          }),
        );
      }),
  );
  assert.ok(timestamp, "The editor must be visible and accept focus");
  await page.keyboard.type("ready");
  assert.equal(await editor.innerText(), "ready");
  return timestamp;
}

async function streamLatency(page, model) {
  const editor = page.locator("[data-composer-editor]");
  await editor.fill("Measure streaming response");
  await editor.press("Enter");
  const reply = await model.nextCompletion();
  await page.evaluate(
    ({ count, content }) => {
      const rendered = new Map();
      let pending = [];
      const scan = () => {
        const presentedAt = performance.timeOrigin + performance.now();
        for (const token of pending) rendered.set(token, presentedAt);
        if (rendered.size === count) return;
        const transcript = document.querySelector(content)?.textContent ?? "";
        pending = [...transcript.matchAll(/token(\d{3})\b/g)]
          .map((match) => Number(match[1]))
          .filter((token) => !rendered.has(token));
        requestAnimationFrame(scan);
      };
      window.pilotBenchmarkFrames = rendered;
      requestAnimationFrame(scan);
    },
    { count: deltaCount, content: '[data-slot="message-scroller-content"]' },
  );

  const sent = [];
  for (let index = 0; index < deltaCount; index++) {
    if (index > 0) await delay(25);
    sent.push(performance.timeOrigin + performance.now());
    reply.write({ content: "token" + String(index).padStart(3, "0") + " " });
  }
  await page.waitForFunction(
    (expected) => window.pilotBenchmarkFrames.size === expected,
    deltaCount,
  );
  const frames = await page.evaluate(() => Array.from(window.pilotBenchmarkFrames.entries()));
  reply.finish();
  await page.getByRole("button", { name: "停止", exact: true }).waitFor({ state: "hidden" });
  const latency = frames.map(([token, visibleAt]) => visibleAt - sent[token]);
  assert.ok(latency.every((value) => Number.isFinite(value) && value >= 0));
  return latency;
}

async function openConversation(page, index) {
  const row = page.locator('[data-session-id="' + chatIds[index] + '"]');
  await row.click();
  await row.and(page.locator('[aria-current="page"]')).waitFor();
  await page
    .getByText("Fixture " + index + " message 0 asks about the selected project.", { exact: true })
    .waitFor({ state: "attached" });
}

async function measureScroll(page) {
  await openConversation(page, 0);
  const scroller = page.locator(viewport);
  await scroller.waitFor();
  assert.equal(await scroller.locator(message).count(), messageCount);
  const result = await scroller.evaluate(
    (element, count) =>
      new Promise((resolve) => {
        let previous;
        let countFrames = 0;
        let maximumPosition = 0;
        const intervals = [];
        const frame = (now) => {
          if (previous !== undefined) intervals.push(now - previous);
          previous = now;
          const progress = countFrames / count;
          const fraction = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
          element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction;
          maximumPosition = Math.max(maximumPosition, element.scrollTop);
          if (countFrames++ < count) requestAnimationFrame(frame);
          else resolve({ intervals, maximumPosition, finalPosition: element.scrollTop });
        };
        requestAnimationFrame(frame);
      }),
    scrollFrames,
  );
  assert.ok(
    result.maximumPosition > 10 * (await scroller.evaluate((element) => element.clientHeight)),
  );
  assert.equal(result.finalPosition, 0);
  return result.intervals;
}

async function measureMemory(page, window, app) {
  const client = await page.context().newCDPSession(page);
  try {
    async function sample(afterSwitches) {
      await client.send("HeapProfiler.collectGarbage");
      const { usedSize } = await client.send("Runtime.getHeapUsage");
      const rendererPid = await window.evaluate((win) => win.webContents.getOSProcessId());
      const { main, renderer } = await app.evaluate(({ app }, rendererPid) => {
        const processes = app.getAppMetrics();
        return {
          main: processes.find(({ pid }) => pid === process.pid)?.memory.workingSetSize,
          renderer: processes.find(({ pid }) => pid === rendererPid)?.memory.workingSetSize,
        };
      }, rendererPid);
      assert.ok(main > 0 && renderer > 0, "Electron must report both process working sets");
      const mib = (bytes) => Math.round((bytes / 1024 ** 2) * 10) / 10;
      return {
        afterSwitches,
        rendererHeapMiB: mib(usedSize),
        rendererWorkingSetMiB: mib(renderer * 1024),
        mainWorkingSetMiB: mib(main * 1024),
      };
    }
    await openConversation(page, 1);
    await openConversation(page, 0);
    const samples = [await sample(0)];
    for (let turn = 1; turn <= switches; turn++) {
      await openConversation(page, turn % 2);
      if (turn % 20 === 0) samples.push(await sample(turn));
    }
    return samples;
  } finally {
    await client.detach();
  }
}

if (process.platform !== "win32") throw new Error("The desktop performance check requires Windows");
const { values } = parseArgs({ options: { executable: { type: "string" } } });
const executable = values.executable && realpathSync.native(resolve(values.executable));
if (!executable) {
  assert.ok(existsSync(join(repository, "out", "renderer", "index.html")), "Run pnpm build first");
}
const temp = realpathSync.native(tmpdir());
const scratch = realpathSync.native(mkdtempSync(join(temp, "pilot-windows-performance-")));
const cold = [];
let model;
let stream;
let scroll;
let memory;
let appInfo;
try {
  model = await startModelFixture();
  for (let run = 0; run < coldRuns; run++) {
    const profile = join(scratch, "launch-" + run);
    seed(profile, model);
    await withDesktop(
      profile,
      async (page, window, app, startedAt) => {
        cold.push((await readyAt(page)) - startedAt);
        if (run === coldRuns - 1) {
          appInfo = await page.evaluate(() => window.pi.getAppInfo());
          stream = await streamLatency(page, model);
          scroll = await measureScroll(page);
          memory = await measureMemory(page, window, app);
        }
      },
      undefined,
      executable,
    );
  }
  console.log(
    "PERFORMANCE_RESULT " +
      JSON.stringify({
        version: appInfo.version,
        artifact: appInfo.isDev ? "electron-vite build" : "packaged Windows app",
        platform: process.platform,
        arch: process.arch,
        cold: {
          targetMs: coldLimitMs,
          ...summarize(cold),
          samplesMs: cold.map((ms) => Math.round(ms)),
        },
        textDeltas: { targetMs: deltaLimitMs, ...summarize(stream) },
        scroll: { messages: messageCount, ...summarize(scroll) },
        memory,
      }),
  );
  assert.ok(
    cold.every((ms) => ms > 0 && ms < coldLimitMs),
    "Cold launch exceeded 3 s",
  );
  assert.ok(
    stream.every((ms) => ms < deltaLimitMs),
    "A text delta took 100 ms or longer to render",
  );
} finally {
  try {
    await model?.close();
  } finally {
    assert.equal(dirname(scratch), temp);
    assert.equal(realpathSync.native(scratch), scratch);
    rmSync(scratch, { recursive: true, maxRetries: 10, retryDelay: 100 });
    assert.ok(!existsSync(scratch));
    console.log("Removed the Windows performance profiles");
  }
}
