// @env node
// 会话持久化：JSONL（每会话一文件，每行一条 AgentMessage）+ index.json 元数据索引。
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionMeta, UiMessage, UiPart } from "@shared/contract";
import { applyPlanUpdate } from "../../shared/plan";
import { labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";

export interface SessionIndex {
  sessions: SessionMeta[];
}

export function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

/** 转录 content 块 → UI parts：text/thinking 保留，其余（toolCall 等）跳过 */
export function messageParts(message: AgentMessage): UiPart[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const parts: UiPart[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: unknown; thinking?: unknown };
    if (b.type === "text" && typeof b.text === "string") {
      parts.push({ type: "text", text: b.text });
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push({ type: "thinking", text: b.thinking });
    }
  }
  return parts;
}

export function toUiMessages(
  messages: AgentMessage[],
  prefix: string,
  getToolLabel = labelOf,
): UiMessage[] {
  let uiMessages: UiMessage[] = [];
  const calls = new Map<string, { messageIndex: number; inputSummary: string }>();
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      const ui: UiMessage = {
        id: `${prefix}-${uiMessages.length}`,
        role: message.role,
        parts: messageParts(message),
      };
      uiMessages.push(ui);
      if (message.role === "assistant" && Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "toolCall" && part.name !== PLAN_TOOL_NAME) {
            calls.set(part.id, {
              messageIndex: uiMessages.length - 1,
              inputSummary: JSON.stringify(part.arguments) ?? "{}",
            });
          }
        }
      }
    } else if (message.role === "toolResult") {
      if (message.toolName === PLAN_TOOL_NAME) {
        const steps = message.isError ? undefined : readPlanSteps(message.details);
        if (steps) uiMessages = applyPlanUpdate(uiMessages, steps);
        continue;
      }
      const call = calls.get(message.toolCallId);
      if (!call) continue;
      calls.delete(message.toolCallId);
      const { details } = message;
      const label =
        details &&
        typeof details === "object" &&
        "toolLabel" in details &&
        typeof details.toolLabel === "string"
          ? details.toolLabel
          : getToolLabel(message.toolName);
      const output = messageText(message);
      uiMessages[call.messageIndex].parts.push({
        type: "tool",
        callId: message.toolCallId,
        toolName: message.toolName,
        label,
        state: message.isError ? "error" : "success",
        inputSummary: call.inputSummary,
        output,
        error: message.isError ? output : undefined,
      });
    }
  }
  return uiMessages;
}

export class SessionStore {
  private index: SessionIndex = { sessions: [] };

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.index = this.readIndex();
  }

  private readIndex(): SessionIndex {
    const path = this.indexPath();
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as SessionIndex;
    } catch {
      return { sessions: [] };
    }
  }

  private writeIndex(): void {
    writeJsonAtomic(this.indexPath(), this.index);
  }

  private indexPath(): string {
    return join(this.dir, "index.json");
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.jsonl`);
  }

  list(): SessionMeta[] {
    return [...this.index.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** 单个会话元数据（host 组装 systemPrompt 时读会话级人设覆盖） */
  getMeta(id: string): SessionMeta | null {
    return this.index.sessions.find((s) => s.id === id) ?? null;
  }

  /** 会话级人设/指令覆盖（null 或空白 = 清除，回落全局 persona） */
  setPersonaOverride(id: string, persona: string | null): SessionMeta | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    if (persona === null || persona.trim().length === 0) {
      delete meta.personaOverride;
    } else {
      meta.personaOverride = persona.trim();
    }
    this.writeIndex();
    return meta;
  }

  create(): SessionMeta {
    const meta: SessionMeta = {
      id: randomUUID(),
      title: "新会话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.index.sessions.push(meta);
    this.writeIndex();
    return meta;
  }

  /** 手动重命名：置 titleCustom，之后的自动标题不再覆盖 */
  rename(id: string, title: string): SessionMeta | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    meta.title = title;
    meta.titleCustom = true;
    meta.updatedAt = Date.now();
    this.writeIndex();
    return meta;
  }

  /** 置顶/取消置顶（侧栏「置顶」分区由渲染层按此字段分组） */
  setPinned(id: string, pinned: boolean): SessionMeta | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    meta.pinned = pinned;
    this.writeIndex();
    return meta;
  }

  /** 归档/取消归档（主列表隐藏 ↔ 已归档分区） */
  setArchived(id: string, archived: boolean): SessionMeta | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    meta.archived = archived;
    this.writeIndex();
    return meta;
  }

  /** 标记/清除未读（打开会话时由 host 清除） */
  setUnread(id: string, unread: boolean): SessionMeta | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    meta.unread = unread;
    this.writeIndex();
    return meta;
  }

  /** 分叉：复制整个转录为新会话（标题 = 分叉：原名，titleCustom 保护），返回新会话元数据 */
  fork(id: string): SessionMeta | null {
    const origin = this.index.sessions.find((s) => s.id === id);
    if (!origin) return null;
    const messages = this.load(id);
    const meta = this.create();
    if (messages.length > 0) this.save(meta.id, messages);
    return this.rename(meta.id, `分叉：${origin.title.slice(0, 21)}`);
  }

  /** 会话全文（复制用）：user/assistant 逐条带角色标签 */
  transcriptText(id: string): string | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    const messages = this.load(id);
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "【用户】" : "【助手】"}${messageText(m)}`)
      .join("\n\n");
  }

  /** 删除：移除转录文件与索引项（文件不存在也照常清索引） */
  remove(id: string): void {
    const path = this.filePath(id);
    if (existsSync(path)) rmSync(path, { force: true });
    this.index.sessions = this.index.sessions.filter((s) => s.id !== id);
    this.writeIndex();
  }

  load(id: string): AgentMessage[] {
    const path = this.filePath(id);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const messages: AgentMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line) as AgentMessage);
      } catch {
        console.error(`[session] 跳过损坏行: ${id}`);
      }
    }
    return messages;
  }

  save(id: string, messages: AgentMessage[]): SessionMeta {
    // NFR-4：临时文件 + rename 原子重写整个转录（Phase 1 转录小，重写成本可忽略）
    const tmp = `${this.filePath(id)}.tmp`;
    writeFileSync(
      tmp,
      messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length > 0 ? "\n" : ""),
      "utf-8",
    );
    renameSync(tmp, this.filePath(id));

    const firstUser = messages.find((m) => m.role === "user");
    const title = firstUser ? messageText(firstUser).slice(0, 24) || "新会话" : "新会话";
    const meta = this.index.sessions.find((s) => s.id === id);
    if (meta) {
      // 手动重命名过的会话：自动标题不覆盖（titleCustom 由 rename 置位）
      if (!meta.titleCustom) meta.title = title;
      meta.updatedAt = Date.now();
    } else {
      this.index.sessions.push({
        id,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    this.writeIndex();
    return meta ?? { id, title, createdAt: Date.now(), updatedAt: Date.now() };
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}
