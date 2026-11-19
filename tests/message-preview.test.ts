import { describe, expect, it } from "vitest";
import { messagePreview, turnPreviews } from "../src/renderer/src/lib/message-preview";
import type { UiMessage } from "../src/shared/contract";

describe("messagePreview", () => {
  it("takes the first non-empty line and collapses whitespace", () => {
    expect(messagePreview("第一行\n\n第二行")).toBe("第一行");
    expect(messagePreview("  多   空格   文本  ")).toBe("多 空格 文本");
  });

  it("truncates long lines with ellipsis", () => {
    const long = "x".repeat(100);
    const result = messagePreview(long, 48);
    expect(result).toHaveLength(49); // 48 字符 + …
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns empty for blank messages", () => {
    expect(messagePreview("\n\n  \n")).toBe("");
  });
});

describe("turnPreviews", () => {
  it("keeps one entry per prompt and previews the latest written reply within the same turn", () => {
    const messages: UiMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "检查构建\n并说明结果" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "我先检查构建。" }] },
      { id: "t1", role: "toolResult", parts: [{ type: "text", text: "工具输出" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "构建通过。\n产物已生成。" }] },
      { id: "a3", role: "assistant", parts: [{ type: "thinking", text: "额外思考" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "结果保存在哪？" }] },
    ];

    expect(turnPreviews(messages)).toEqual([
      { id: "u1", question: "检查构建\n并说明结果", answer: "构建通过。" },
      { id: "u2", question: "结果保存在哪？", answer: "" },
    ]);
  });
});
