// @env node
import { afterEach, describe, expect, it } from "vitest";
import { useFileChangesStore } from "../src/renderer/src/stores/file-changes";

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
});
