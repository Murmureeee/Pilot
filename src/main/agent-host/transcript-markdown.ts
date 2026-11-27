// @env node
import type { Locale, UiMessage, UiPart } from "@shared/contract";

import { toolInput } from "../../shared/tool-input";
import { webLink } from "../../shared/web";

const labels = {
  zh: {
    user: "用户",
    assistant: "助手",
    thinking: "思考",
    plan: "任务计划",
    summary: "上下文摘要",
    image: "图片附件",
    sources: "网页来源",
  },
  "zh-TW": {
    user: "使用者",
    assistant: "助理",
    thinking: "思考",
    plan: "工作計畫",
    summary: "上下文摘要",
    image: "圖片附件",
    sources: "網頁來源",
  },
  en: {
    user: "User",
    assistant: "Assistant",
    thinking: "Reasoning",
    plan: "Plan",
    summary: "Context summary",
    image: "Image attachment",
    sources: "Web sources",
  },
} as const;

function backticks(text: string, minimum: number): string {
  let count = minimum;
  for (const [run] of text.matchAll(/\x60+/g)) count = Math.max(count, run.length + 1);
  return "\x60".repeat(count);
}

function codeBlock(text: string): string {
  const fence = backticks(text, 3);
  return fence + "text\n" + text.trimEnd() + "\n" + fence;
}

function heading(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\\x60*_<>#[\]]/g, "\\$&");
}

function userText(parts: readonly UiPart[], locale: Locale): string {
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "image") return "\n\n" + labels[locale].image + " · " + heading(part.name);
      if (part.type !== "mention") return "";
      const reference = "@" + (part.kind === "skill" ? part.label : part.id);
      const fence = backticks(reference, 1);
      return fence + " " + reference + " " + fence;
    })
    .join("");
}

function assistantParts(parts: readonly UiPart[], locale: Locale): string[] {
  const words = labels[locale];
  const blocks: string[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text.trim()) blocks.push(part.text);
    if (part.type === "thinking" && part.text.trim()) {
      blocks.push("### " + words.thinking, part.text);
    }
    if (part.type === "plan") {
      blocks.push(
        "### " + words.plan,
        part.steps
          .map(
            ({ title, status }) => (status === "completed" ? "- [x] " : "- [ ] ") + heading(title),
          )
          .join("\n"),
      );
    }
    if (part.type === "tool") {
      blocks.push("### " + heading(part.toolName));
      const { preview, details } = toolInput(part.inputSummary);
      const input = part.toolName === "bash" ? preview : details;
      if (input.trim()) blocks.push(codeBlock(input));
      const output = part.output?.trim() || part.error;
      if (output) blocks.push(codeBlock(output));
      const sources = (part.sources ?? []).flatMap((source) => {
        const url = webLink(source.url);
        if (!url) return [];
        const title = source.section ? source.title + " / " + source.section : source.title;
        return ["- [" + heading(title) + "](<" + url.href + ">)"];
      });
      if (sources.length) blocks.push("#### " + words.sources, sources.join("\n"));
    }
  }
  return blocks;
}

export function transcriptMarkdown(
  title: string,
  messages: readonly UiMessage[],
  locale: Locale,
): string {
  const words = labels[locale];
  const sections = ["# " + heading(title)];
  for (const message of messages) {
    if (message.role === "user") {
      const text = userText(message.parts, locale).trimStart();
      if (text.trim()) sections.push("## " + words.user, text);
    } else if (message.role === "assistant") {
      const blocks = assistantParts(message.parts, locale);
      if (blocks.length) sections.push("## " + words.assistant, ...blocks);
    } else if (message.role === "system") {
      for (const part of message.parts) {
        if (part.type === "compaction" && part.compaction.summary.trim())
          sections.push("## " + words.summary, part.compaction.summary);
      }
    }
  }
  return sections.join("\n\n") + "\n";
}

export function transcriptFilename(title: string): string {
  let name = title
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, "-")
    .trim()
    .slice(0, 100)
    .replace(/[ .]+$/u, "");
  if (!name) name = "Pilot";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = "_" + name;
  return name + ".md";
}
