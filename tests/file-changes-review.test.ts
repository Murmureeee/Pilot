// @env node
import { afterEach, describe, expect, it } from "vitest";
import { fileChangesTree, fileChangeFolderPaths } from "../src/renderer/src/lib/file-changes";
import { useFileChangesStore } from "../src/renderer/src/stores/file-changes";
import type { FileChangeSummary } from "../src/shared/contract";

afterEach(() => useFileChangesStore.getState().close());

describe("file changes navigation", () => {
  it("reuses the open reply and keeps existing expansions when jumping to files", () => {
    const { open } = useFileChangesStore.getState();
    const reply = { sessionId: "chat", replyId: "reply" };
    open(reply);
    expect(useFileChangesStore.getState().review?.expanded).toEqual([]);
    open({ ...reply, changeId: "first" });
    open({ ...reply, changeId: "second" });
    const second = useFileChangesStore.getState().review;
    expect(second).toMatchObject({ expanded: ["first", "second"], jump: { changeId: "second" } });
    open({ ...reply, changeId: "second" });
    const repeated = useFileChangesStore.getState().review;
    expect(repeated?.expanded).toEqual(["first", "second"]);
    expect(repeated?.jump).not.toBe(second?.jump);
  });

  it("switches the files within the pane when opening a different reply", () => {
    const { open, cancelUndo } = useFileChangesStore.getState();
    open({ sessionId: "chat", replyId: "one", changeId: "old" });
    open({ sessionId: "chat", replyId: "two", changeId: "current", confirmUndo: true });
    cancelUndo("old");
    expect(useFileChangesStore.getState().review).toMatchObject({
      replyId: "two",
      expanded: ["current"],
      undoChangeId: "current",
    });
  });

  it("opens the target's ancestor folders and keeps other folders collapsed", () => {
    const { open, setFolderOpen } = useFileChangesStore.getState();
    const reply = { sessionId: "chat", replyId: "reply" };
    open({ ...reply, changeId: "first" });
    setFolderOpen("src", false);
    setFolderOpen("src/tools", false);
    setFolderOpen("tests", false);
    open({ ...reply, changeId: "tool", changePath: "src/tools/exec.ts" });
    expect(useFileChangesStore.getState().review).toMatchObject({
      expanded: ["first", "tool"],
      collapsedFolders: ["tests"],
      jump: { changeId: "tool" },
    });
    setFolderOpen("src", false);
    expect(useFileChangesStore.getState().review?.collapsedFolders).toEqual(["tests", "src"]);
  });

  it("groups repeated edits under their full directory path and preserves root files", () => {
    const changes: FileChangeSummary[] = [
      { id: "one", kind: "created", path: "src/tools/main.ts" },
      { id: "two", kind: "modified", path: "src/tools/main.ts" },
      { id: "three", kind: "modified", path: "tests/tools/main.ts" },
      { id: "four", kind: "modified", path: "README.md" },
    ];
    expect(fileChangesTree(changes)).toEqual([
      {
        kind: "directory",
        name: "src",
        path: "src",
        children: [
          {
            kind: "directory",
            name: "tools",
            path: "src/tools",
            children: [
              { kind: "file", name: "main.ts", change: changes[0] },
              { kind: "file", name: "main.ts", change: changes[1] },
            ],
          },
        ],
      },
      {
        kind: "directory",
        name: "tests",
        path: "tests",
        children: [
          {
            kind: "directory",
            name: "tools",
            path: "tests/tools",
            children: [{ kind: "file", name: "main.ts", change: changes[2] }],
          },
        ],
      },
      { kind: "file", name: "README.md", change: changes[3] },
    ]);
    expect(fileChangeFolderPaths("E:\\pilot\\src\\main.ts")).toEqual([
      "E:",
      "E:/pilot",
      "E:/pilot/src",
    ]);
    expect(fileChangeFolderPaths("/usr/src/main.ts")).toEqual(["/", "/usr", "/usr/src"]);
  });
});
