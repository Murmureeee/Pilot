// @env all
import type { AgentRunEvent, ContextCompaction, UiMessage, UiPart } from "./contract";
import { applyPlanUpdate } from "./plan";

type ToolPart = Extract<UiPart, { type: "tool" }>;

function updateAssistant(
  messages: UiMessage[],
  id: string | undefined,
  update: (message: UiMessage) => UiMessage,
): UiMessage[] {
  const index =
    id === undefined ? messages.length - 1 : messages.findLastIndex((message) => message.id === id);
  const message = messages[index];
  return message?.role === "assistant" ? messages.with(index, update(message)) : messages;
}

function updateTool(
  messages: UiMessage[],
  callId: string,
  update: (part: ToolPart) => ToolPart,
): UiMessage[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const partIndex = message.parts.findIndex(
      (part) => part.type === "tool" && part.callId === callId,
    );
    const part = message.parts[partIndex];
    if (part?.type === "tool") {
      return messages.with(index, {
        ...message,
        parts: message.parts.with(partIndex, update(part)),
      });
    }
  }
  return messages;
}

export function applyMessageEvent(messages: UiMessage[], event: AgentRunEvent): UiMessage[] {
  switch (event.type) {
    case "context_compacted":
      return insertCompactionMarker(messages, event.compaction);
    case "messages":
      return event.messages;
    case "user_message":
      return [...messages, event.message];
    case "assistant_start":
      return [
        ...messages,
        { id: event.id, role: "assistant", parts: [], streaming: true, timing: event.timing },
      ];
    case "model_retry":
      return event.resetReplyId === undefined
        ? messages
        : updateAssistant(messages, event.resetReplyId, (message) => ({ ...message, parts: [] }));
    case "assistant_delta":
      return updateAssistant(messages, event.id, (message) => {
        const last = message.parts.at(-1);
        const part: UiPart = {
          type: "text",
          text: (last?.type === "text" ? last.text : "") + event.delta,
        };
        return {
          ...message,
          parts: last?.type === "text" ? message.parts.with(-1, part) : [...message.parts, part],
        };
      });
    case "assistant_end":
      return updateAssistant(messages, event.id, (message) => ({
        ...message,
        streaming: false,
        timing: event.timing,
        parts: message.parts.map((part) =>
          part.type === "thinking" && part.streaming ? { ...part, streaming: false } : part,
        ),
      }));
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
      return updateAssistant(messages, event.id, (message) => {
        const blockIndex = event.blockIndex;
        const index = message.parts.findIndex(
          (part) => part.type === "thinking" && part.blockIndex === blockIndex,
        );
        const previous = message.parts[index];
        const previousText = previous?.type === "thinking" ? previous.text : "";
        const part: UiPart =
          event.type === "thinking_end"
            ? {
                type: "thinking",
                blockIndex,
                text: event.text,
                durationMs: event.durationMs,
                streaming: false,
              }
            : {
                type: "thinking",
                blockIndex,
                text: previousText + (event.type === "thinking_delta" ? event.delta : ""),
                streaming: true,
              };
        return {
          ...message,
          parts: index < 0 ? [...message.parts, part] : message.parts.with(index, part),
        };
      });
    case "tool_call":
    case "tool_start": {
      const state = event.type === "tool_start" ? "running" : "pending";
      const { callId, toolName, label, inputSummary } = event;
      const updated = updateTool(messages, callId, (part) =>
        state === "pending" ? part : { ...part, state, inputSummary },
      );
      if (updated !== messages) return updated;
      return updateAssistant(messages, event.id, (message) => ({
        ...message,
        parts: [...message.parts, { type: "tool", callId, toolName, label, state, inputSummary }],
      }));
    }
    case "tool_update":
      return updateTool(messages, event.callId, (part) => ({ ...part, output: event.output }));
    case "tool_end":
      return updateTool(messages, event.callId, (part) => ({
        ...part,
        state: event.state,
        output: event.output ?? part.output,
        error: event.error,
        durationMs: event.durationMs,
      }));
    case "file_change":
      return updateTool(messages, event.callId, (part) => ({ ...part, fileChange: event.change }));
    case "plan":
      return applyPlanUpdate(messages, event.steps);
    default:
      return messages;
  }
}

export function insertCompactionMarker(
  messages: UiMessage[],
  compaction: ContextCompaction,
): UiMessage[] {
  const { id, position, summary, trimmedTools } = compaction;
  const markerId = "compaction-" + id;
  if (messages.some((message) => message.id === markerId)) return messages;
  let visible = 0;
  const next = messages.findIndex(
    ({ role }) => (role === "user" || role === "assistant") && visible++ === position,
  );
  return messages.toSpliced(next < 0 ? messages.length : next, 0, {
    id: markerId,
    role: "system",
    parts: [{ type: "compaction", compaction: { id, position, summary, trimmedTools } }],
  });
}
