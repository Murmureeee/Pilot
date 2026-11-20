import { describe, expect, it } from "vitest";
import { composerTrigger, promptWithReferences } from "../src/renderer/src/lib/composer-shortcuts";

describe("composer shortcuts", () => {
  it("finds a command at the start of the draft and preserves ordinary paths and URLs", () => {
    expect(composerTrigger("/model", 6, 6)).toEqual({
      kind: "command",
      start: 0,
      end: 6,
      query: "model",
    });
    for (const text of ["/usr/local/bin", "https://example.com/a", "look at /model"]) {
      expect(composerTrigger(text, text.length, text.length)).toBeNull();
    }
  });

  it("filters the reference at the caret without taking its neighboring punctuation", () => {
    const text = "检查（@src/readme.md），然后总结";
    const caret = text.indexOf("readme");
    expect(composerTrigger(text, caret, caret)).toEqual({
      kind: "reference",
      start: text.indexOf("@"),
      end: text.indexOf("）"),
      query: "src/",
    });
    expect(composerTrigger("查看@文档", 5, 5)).toMatchObject({
      kind: "reference",
      query: "文档",
    });
    expect(composerTrigger("name@domain", 11, 11)).toBeNull();
    expect(composerTrigger(text, caret - 1, caret)).toBeNull();
  });

  it("appends selected paths to the ordinary prompt so they persist with the message", () => {
    expect(promptWithReferences("review", [], "Workspace references")).toBe("review");
    expect(
      promptWithReferences(
        "review",
        [
          { path: "notes/draft one.md", kind: "file" },
          { path: "src", kind: "directory" },
        ],
        "Workspace references",
      ),
    ).toBe('review\n\nWorkspace references\n- "notes/draft one.md"\n- "src/"');
  });
});
