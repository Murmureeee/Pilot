import {
  appendFileSync,
  existsSync,
  mkdtempDisposableSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DiagnosticLog, errorDetails } from "../src/main/diagnostics";
import { logRendererConsole } from "../src/main/diagnostics/renderer";
import { DIAGNOSTIC_EVENT_LIMIT } from "../src/shared/constants";

describe("local diagnostics", () => {
  it("applies level changes to the running logger and stops writing when disabled", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const file = join(fixture.path, "pilot.log");
    const log = new DiagnosticLog(fixture.path, "warn");
    log.write("info", "main", "startup");
    expect(existsSync(file)).toBe(false);
    log.write("warn", "renderer", "console");
    log.setLevel("debug");
    log.write("debug", "updater", "unavailable");
    log.setLevel("off");
    log.write("error", "main", "agent-error");
    const entries = readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries).toEqual([
      expect.objectContaining({ source: "renderer", event: "console", level: "warn" }),
      expect.objectContaining({ source: "updater", event: "unavailable", level: "debug" }),
    ]);
  });

  it("bounds retention and keeps complete newest records through repeated rotation", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const limit = 256;
    const log = new DiagnosticLog(fixture.path, "info", limit);
    for (let i = 0; i < 20; i += 1) log.write("info", "main", "startup", { code: i });

    const files = readdirSync(fixture.path).sort();
    expect(files).toEqual(["pilot.log", "pilot.log.1", "pilot.log.2"]);
    for (const file of files)
      expect(statSync(join(fixture.path, file)).size).toBeLessThanOrEqual(limit);
    const codes = (await log.events()).map(({ code }) => code);
    expect(codes[0]).toBe(19);
    expect(codes).not.toContain(0);
    expect(codes.every((code, index) => code === 19 - index)).toBe(true);
  });

  it("retains error categories while removing private error and console text", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const log = new DiagnosticLog(fixture.path, "info");
    const privateText = "private-test-credential";
    const failure = Object.assign(new Error(`Authorization: Bearer ${privateText}`), {
      code: "ECONNREFUSED",
    });
    log.write("error", "updater", "error", errorDetails(failure));
    logRendererConsole(log, {
      level: "error",
      message: `Uncaught (in promise) TypeError: ${privateText}`,
      lineNumber: 42,
    });
    const text = readFileSync(join(fixture.path, "pilot.log"), "utf8");
    expect(text).not.toContain(privateText);
    expect(text).not.toContain("Authorization");
    const [updater, renderer] = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(updater).toMatchObject({ source: "updater", code: "ECONNREFUSED" });
    expect(renderer).toMatchObject({ source: "renderer", errorName: "TypeError", line: 42 });
  });

  it("continues running when its log directory is unavailable", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const blocked = join(fixture.path, "blocked");
    writeFileSync(blocked, "keep this file");
    const log = new DiagnosticLog(blocked, "info");
    using warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.write("info", "main", "startup");
    log.write("error", "renderer", "load-failed");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readFileSync(blocked, "utf8")).toBe("keep this file");
  });

  it("only exposes validated metadata from older and partially written logs", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const file = join(fixture.path, "pilot.log");
    const log = new DiagnosticLog(fixture.path, "debug");
    const time = "2026-11-27T04:05:06.123Z";
    const entry = { time, level: "error", source: "renderer", event: "process-gone" };
    const secret = "synthetic-credential";
    const lines = [
      { ...entry, time: secret },
      { ...entry, time: "2026-02-30T04:05:06.123Z" },
      { ...entry, level: secret },
      { ...entry, source: "__proto__" },
      { ...entry, source: "updater" },
      { ...entry, event: secret },
      {
        ...entry,
        reason: secret,
        version: "1.2.3+" + secret,
        code: secret,
        errorName: secret,
        processType: secret,
        line: -1,
        message: secret,
        path: secret,
        command: secret,
      },
    ];
    writeFileSync(file + ".1", lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
    log.write("error", "child", "process-gone", {
      reason: "crashed",
      code: 0xc0000005,
      processType: "GPU",
    });
    appendFileSync(file, JSON.stringify(entry));
    const report = await log.report("1.2.3");
    expect(JSON.parse(JSON.stringify(report.events))).toEqual([
      expect.objectContaining({
        source: "child",
        processType: "GPU",
        reason: "crashed",
        code: 0xc0000005,
      }),
      entry,
    ]);
    expect(report.runtime.app).toBe("1.2.3");
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("limits previews and still exports every retained event", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const log = new DiagnosticLog(fixture.path, "info");
    for (let index = 0; index <= DIAGNOSTIC_EVENT_LIMIT; index++)
      log.write("info", "main", "startup", { code: index });
    expect(await log.events(DIAGNOSTIC_EVENT_LIMIT)).toHaveLength(DIAGNOSTIC_EVENT_LIMIT);
    expect((await log.report("1.2.3")).events).toHaveLength(DIAGNOSTIC_EVENT_LIMIT + 1);
  });

  it("records interruptions at the next start, ignores clean quits and respects disabled logging", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const file = join(fixture.path, ".running");
    const version = "1.2.3";
    new DiagnosticLog(fixture.path, "error").startRun(version);
    expect(existsSync(file)).toBe(true);
    const restarted = new DiagnosticLog(fixture.path, "error");
    restarted.startRun(version);
    restarted.finishRun();
    expect(existsSync(file)).toBe(false);
    restarted.startRun(version);
    restarted.setLevel("off");
    expect(existsSync(file)).toBe(false);
    restarted.setLevel("info");
    expect(existsSync(file)).toBe(true);
    restarted.finishRun();
    expect((await restarted.events()).map(({ event }) => event)).toEqual([
      "quit",
      "previous-run-interrupted",
    ]);
  });
});
