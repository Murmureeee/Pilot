import {
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

  it("bounds retention and keeps complete newest records through repeated rotation", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-log-"));
    const limit = 256;
    const log = new DiagnosticLog(fixture.path, "info", limit);
    for (let i = 0; i < 20; i += 1) log.write("info", "main", `new-window-${i}`);

    const files = readdirSync(fixture.path).sort();
    expect(files).toEqual(["pilot.log", "pilot.log.1", "pilot.log.2"]);
    const events = files.flatMap((file) => {
      const path = join(fixture.path, file);
      expect(statSync(path).size).toBeLessThanOrEqual(limit);
      return readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).event);
    });
    expect(events).toContain("new-window-19");
    expect(events).not.toContain("new-window-0");
    expect(new Set(events).size).toBe(events.length);
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
});
