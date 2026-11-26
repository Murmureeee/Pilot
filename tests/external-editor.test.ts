// @env node
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { openExternalEditor } from "../src/main/workspace/editor";

vi.mock("node:child_process", { spy: true });

const mockSpawn = vi.mocked(spawn);
const windows = process.platform === "win32";

function captureLaunch(error?: Error): ReturnType<typeof vi.fn<() => void>> {
  const unref = vi.fn<() => void>();
  mockSpawn.mockImplementationOnce(() => {
    const process = Object.assign(new EventEmitter(), { unref });
    queueMicrotask(() => {
      if (error) process.emit("error", error);
      else process.emit("spawn");
    });
    return process as unknown as ReturnType<typeof spawn>;
  });
  return unref;
}

describe("external editor launches", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    mockSpawn.mockClear();
  });

  it.each([
    [undefined, "code", "Code.exe"],
    [{ kind: "cursor" }, "cursor", "Cursor.exe"],
  ] as const)(
    "locates the configured code editor and opens a line",
    async (editor, command, exe) => {
      using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-editor-preset-"));
      const bin = join(fixture.path, "bin");
      mkdirSync(bin);
      const launcher = windows ? join(fixture.path, exe) : join(bin, command);
      writeFileSync(launcher, "", { mode: 0o755 });
      vi.stubEnv("PATH", bin);
      const unref = captureLaunch();
      const path = join(fixture.path, "说明 & notes.txt");
      await openExternalEditor(path, 9, editor);
      expect(mockSpawn).toHaveBeenCalledExactlyOnceWith(
        launcher,
        ["--goto", path + ":9:1"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(unref).toHaveBeenCalledOnce();
    },
  );

  it("passes a JetBrains file and line to a launcher on PATH", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-jetbrains-"));
    const launcher = join(fixture.path, windows ? "idea64.exe" : "idea64");
    writeFileSync(launcher, "", { mode: 0o755 });
    vi.stubEnv("PATH", fixture.path);
    const path = join(fixture.path, "existing report.txt");
    captureLaunch();
    await openExternalEditor(path, 3, { kind: "jetbrains", command: "idea64" });
    expect(mockSpawn).toHaveBeenCalledWith(launcher, ["--line", "3", path], expect.any(Object));
    captureLaunch();
    await openExternalEditor(path, undefined, { kind: "jetbrains", command: "idea64" });
    expect(mockSpawn).toHaveBeenLastCalledWith(launcher, [path], expect.any(Object));
  });

  it("substitutes custom arguments once and retains spaces and shell punctuation", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-custom-editor-"));
    const launcher = join(fixture.path, windows ? "editor command.exe" : "editor command");
    writeFileSync(launcher, "", { mode: 0o755 });
    const path = join(fixture.path, "资料 & {line}.txt");
    captureLaunch();
    await openExternalEditor(path, undefined, {
      kind: "custom",
      command: '"' + launcher + '"',
      args: ["--file", "{file}", "line {line}", "keep & spaces"],
    });
    expect(mockSpawn).toHaveBeenCalledExactlyOnceWith(
      launcher,
      ["--file", path, "line 1", "keep & spaces"],
      expect.objectContaining({ detached: true, stdio: "ignore" }),
    );
    expect(mockSpawn.mock.calls[0][2]).not.toHaveProperty("shell", true);
  });

  it("distinguishes a missing launcher from a failed start", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-editor-failure-"));
    const launcher = join(fixture.path, windows ? "editor.exe" : "editor");
    const editor = { kind: "custom", command: launcher, args: ["{file}"] } as const;
    const config = { ...editor, args: [...editor.args] };
    const path = join(fixture.path, "notes.txt");
    await expect(openExternalEditor(path, 3, config)).rejects.toThrow("找不到外部编辑器");
    expect(mockSpawn).not.toHaveBeenCalled();
    writeFileSync(launcher, "", { mode: 0o755 });
    const unref = captureLaunch(new Error("access denied"));
    await expect(openExternalEditor(path, 3, config)).rejects.toThrow("外部编辑器启动失败");
    expect(unref).not.toHaveBeenCalled();
  });
});
