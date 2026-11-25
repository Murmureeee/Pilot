import { describe, expect, it } from "vitest";

import {
  composerEnterAction,
  composerTrigger,
  matchesComposerQuery,
  trimPrompt,
} from "../src/renderer/src/lib/composer-shortcuts";
import type { PromptMention } from "../src/shared/contract";
import { promptFromDraft } from "../src/shared/mentions";

describe("composer shortcuts", () => {
  it("finds the entire slash token while leaving neighboring prose outside the token", () => {
    expect(composerTrigger("/model", 6, 6)).toEqual({
      kind: "command",
      start: 0,
      end: 6,
      query: "model",
    });
    const draft = "保留这段 /模型 和后续内容";
    const start = draft.indexOf("/");
    expect(composerTrigger(draft, start + 2, start + 2)).toEqual({
      kind: "command",
      start,
      end: start + 3,
      query: "模",
    });
    for (const text of ["/usr/local/bin", "https://example.com/a", "查看 资料/文档"]) {
      expect(composerTrigger(text, text.length, text.length)).toBeNull();
    }
    expect(composerTrigger("/usr/local/bin", 4, 4)).toBeNull();
  });

  it("filters the reference at the caret without taking its neighboring punctuation", () => {
    const text = "检查（@src/readme.md），然后总结";
    const caret = text.indexOf("readme");
    expect(composerTrigger(text, caret, caret)).toEqual({
      kind: "mention",
      start: text.indexOf("@"),
      end: text.indexOf("）"),
      query: "src/",
    });
    expect(composerTrigger("查看@文档", 5, 5)).toMatchObject({
      kind: "mention",
      query: "文档",
    });
    expect(composerTrigger("name@domain", 11, 11)).toBeNull();
    expect(composerTrigger("See @readme.md, please", 7, 7)?.end).toBe(14);
    expect(composerTrigger(text, caret - 1, caret)).toBeNull();
  });

  it("matches localized command labels by ordered characters", () => {
    expect(matchesComposerQuery("Choose a model", "ＣＭＤ")).toBe(true);
    expect(matchesComposerQuery("选择模型", "选模")).toBe(true);
    expect(matchesComposerQuery("选择模型", "模型选")).toBe(false);
  });

  it("serializes chips at their inline positions and leaves typed at-signs as ordinary text", () => {
    const file: PromptMention = {
      type: "file",
      id: "notes/report [draft].md",
      label: "draft",
      meta: { workingDirectory: "E:/work" },
    };
    const skill: PromptMention = {
      type: "skill",
      id: "review",
      label: "Review",
      meta: { description: "Review changes" },
    };
    expect(promptFromDraft(["Email @team about ", file, " with ", skill, "."])).toEqual({
      text: "Email @team about @[file:notes/report %5Bdraft%5D.md] with @[skill:review].",
      mentions: [
        { ...file, offset: "Email @team about ".length },
        { ...skill, offset: "Email @team about @[file:notes/report %5Bdraft%5D.md] with ".length },
      ],
    });
    expect(promptFromDraft(["@[file:typed.txt]"])).toEqual({
      text: "@[file:typed.txt]",
      mentions: [],
    });
    const prefix = "查看原文 @[file:notes/report %5Bdraft%5D.md] 和 ";
    expect(trimPrompt(promptFromDraft(["  " + prefix, file, "   "]))).toEqual({
      text: prefix + "@[file:notes/report %5Bdraft%5D.md]",
      mentions: [{ ...file, offset: prefix.length }],
    });
  });

  it("maps Enter to send or newline by the send-key preference", () => {
    const key = (
      mods: Partial<Record<"shiftKey" | "ctrlKey" | "metaKey", boolean>> = {},
    ): { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } => ({
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...mods,
    });
    expect(composerEnterAction(key(), "enter")).toBe("send");
    expect(composerEnterAction(key({ shiftKey: true }), "enter")).toBeNull();
    expect(composerEnterAction(key(), "mod-enter")).toBe("newline");
    expect(composerEnterAction(key({ ctrlKey: true }), "mod-enter")).toBe("send");
    expect(composerEnterAction(key({ metaKey: true }), "mod-enter")).toBe("send");
    expect(composerEnterAction(key({ shiftKey: true }), "mod-enter")).toBeNull();
    expect(composerEnterAction({ ...key(), key: "a" }, "mod-enter")).toBeNull();
  });
});
