// @env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import * as models from "../src/main/agent-host/models";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import type { UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

it("reverts selected task hunks and whole files while preserving user work and the Git index", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-git-checkpoint-"));
  const root = realpathSync(fixture.path);
  const project = join(root, "Project");
  mkdirSync(project);
  const git = (...args: string[]): string =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
    }).trimEnd();
  const write = (path: string, text: string): void => writeFileSync(join(project, path), text);
  const read = (path: string): string => readFileSync(join(project, path), "utf8");
  const name = "mixed # file.txt";
  const lines = Array.from({ length: 50 }, (_, index) => "source " + (index + 1));
  const source = lines.join("\r\n");
  const staged = source.replace("source 1\r\n", "staged user text\r\n");
  const user = "unstaged heading\r\n" + staged.replace("source 3\r\n", "unstaged user text\r\n");
  const firstTask = user.replace("source 18\r\n", "first task hunk\r\n");
  const secondTask = user.replace("source 38\r\n", "second task hunk\r\n");
  const allTask = firstTask.replace("source 38\r\n", "second task hunk\r\n");
  git("init", "-q");
  git("config", "core.autocrlf", "true");
  git("config", "core.safecrlf", "false");
  write(name, source);
  write("ambiguous.txt", "base\n");
  write("late.txt", "base\n");
  write("index changed.txt", "base\n");
  write("deleted.txt", "restore this exact content");
  git("add", ".");
  git(
    "-c",
    "user.name=Pilot Test",
    "-c",
    "user.email=pilot@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Checkpoint fixture",
  );
  write(name, staged);
  git("add", name);
  write(name, user);
  write("ambiguous.txt", "user line\n");
  write("user untracked.txt", "user untracked\n");
  const index = join(project, ".git", "index");
  const initialIndex = readFileSync(index);

  const command =
    process.platform === "win32"
      ? "$ErrorActionPreference = 'Stop'\nSet-Content -LiteralPath 'ambiguous.txt' -Value 'command replaced user line' -NoNewline\nRemove-Item -LiteralPath 'deleted.txt'"
      : "printf 'command replaced user line' > ambiguous.txt && rm deleted.txt";
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("write_file", { path: name, content: allTask }),
        fauxToolCall("write_file", { path: "late.txt", content: "task edit\n" }),
        fauxToolCall("write_file", { path: "index changed.txt", content: "task edit\n" }),
        fauxToolCall("write_file", { path: "added.txt", content: "task addition\n" }),
        fauxToolCall("bash", { command }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([fauxText("Finished editing the fixture.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: catalog.streamSimple.bind(catalog),
  });
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  const dir = join(root, "sessions");
  const createHost = (): AgentHost =>
    new AgentHost({
      store: new SessionStore(dir),
      getSettings: () => settings,
      saveSettings: vi.fn<(settings: Settings) => void>(),
      broadcast: vi.fn<(event: UiAgentEvent) => void>(),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  let host = createHost();
  const { composerId } = host.openProject(project);
  try {
    await host.prompt("Edit the fixture", composerId);
    const request = { area: "unstaged", path: name } as const;
    const view = await host.getGitChanges(composerId);
    const checkpoint = view?.checkpoint;
    expect(checkpoint?.files.map(({ path }) => path)).toEqual([
      "added.txt",
      "ambiguous.txt",
      "deleted.txt",
      "index changed.txt",
      "late.txt",
      name,
    ]);
    const checkpointId = checkpoint!.id;
    const detail = (path: string) => host.getGitCheckpointDiff(composerId, checkpointId, path);
    const preview = (path: string, hunks?: number[]) =>
      host.previewGitRollback(composerId, {
        path,
        checkpointId,
        revision: detail(path).revision,
        hunks,
      });
    const apply = (token: string) => host.applyGitRollback(composerId, token);

    const stagedDiff = await host.getGitFileDiff(composerId, { area: "staged", path: name });
    expect(stagedDiff.lineTargets?.[1]).toBe(2);
    expect(stagedDiff.diff?.hunks.flat()).toContainEqual({
      kind: "added",
      after: 1,
      text: "staged user text",
    });
    const worktreeDiff = await host.getGitFileDiff(composerId, request);
    expect(worktreeDiff.diff?.hunks.flat().filter((line) => line.kind !== "context")).toHaveLength(
      7,
    );
    expect(worktreeDiff.diff?.hunks.flat()).toEqual(
      expect.arrayContaining([
        { kind: "added", after: 4, text: "unstaged user text" },
        { kind: "added", after: 19, text: "first task hunk" },
      ]),
    );
    expect(await host.getGitEditorPath(composerId, request, 19)).toBe(
      join(realpathSync.native(project), name),
    );

    expect(detail(name)).toMatchObject({ wholeFile: true, hunks: [true, true], canOpen: true });
    const first = await preview(name, [0]);
    expect(first.diff.hunks.flat().filter((line) => line.kind !== "context")).toEqual([
      { kind: "removed", before: 19, text: "first task hunk" },
      { kind: "added", after: 19, text: "source 18" },
    ]);
    expect(read(name)).toBe(allTask);
    await apply(first.token);
    expect(read(name)).toBe(secondTask);
    expect(readFileSync(index)).toEqual(initialIndex);

    host = createHost();
    host.loadSession(composerId);
    expect(detail(name)).toMatchObject({ hunks: [true], wholeFile: true });
    const whole = await preview(name);
    expect(
      whole.diff.hunks
        .flat()
        .filter((line) => line.kind === "removed")
        .map(({ text }) => text),
    ).toEqual(["second task hunk"]);
    await apply(whole.token);
    expect(read(name)).toBe(user);
    expect(git("show", ":" + name)).toBe(staged.replaceAll("\r\n", "\n"));
    expect(readFileSync(index)).toEqual(initialIndex);
    expect(await host.getGitChanges(composerId)).toMatchObject({
      checkpoint: {
        files: expect.arrayContaining([expect.objectContaining({ path: name, reverted: true })]),
      },
    });

    expect(detail("ambiguous.txt")).toMatchObject({
      hunks: [false],
      wholeFile: false,
      conflict: "ownership",
    });
    await expect(preview("ambiguous.txt")).rejects.toThrow("存在冲突");
    expect(read("ambiguous.txt")).toBe("command replaced user line");

    const late = await preview("late.txt");
    write("late.txt", "task edit\nlater user edit\n");
    await expect(apply(late.token)).rejects.toThrow("文件已有后续改动");
    expect(read("late.txt")).toBe("task edit\nlater user edit\n");
    expect(detail("late.txt")).toMatchObject({ conflict: "later-edit", wholeFile: false });

    const creation = await preview("added.txt");
    expect(creation.operation).toBe("delete");
    await apply(creation.token);
    expect(existsSync(join(project, "added.txt"))).toBe(false);
    const deletion = await preview("deleted.txt");
    expect(deletion.operation).toBe("create");
    await apply(deletion.token);
    expect(read("deleted.txt")).toBe("restore this exact content");
    expect(read("user untracked.txt")).toBe("user untracked\n");
    expect(readFileSync(index)).toEqual(initialIndex);

    const indexDrift = await preview("index changed.txt");
    git("add", "index changed.txt");
    const stagedLater = readFileSync(index);
    await expect(apply(indexDrift.token)).rejects.toThrow("文件的暂存内容已变更");
    expect(readFileSync(index)).toEqual(stagedLater);
    expect(read("index changed.txt")).toBe("task edit\n");
  } finally {
    resolve.mockRestore();
  }
}, 20_000);
