// @env node
// Phase 0 冒烟：验证 pi Agent 能在 Electron 主进程的 Node 运行时中完整跑一轮。
// 用 pi-ai 的 faux provider（内存脚本响应），无需任何 API Key。
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";

import type { AgentSmokeResult } from "@shared/contract";

export async function runAgentSmoke(): Promise<AgentSmokeResult> {
  const nodeVersion = process.versions.node;
  const eventTypes = new Set<string>();
  let replyText = "";

  try {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);

    const model = faux.getModel();
    if (!model) throw new Error("faux model not found");

    faux.setResponses([fauxAssistantMessage([fauxText("pong from pi agent (faux)")])]);

    const agent = new Agent({
      initialState: {
        systemPrompt: "You are a helpful assistant.",
        model,
      },
      streamFn: models.streamSimple.bind(models),
    });

    agent.subscribe((event) => {
      eventTypes.add(event.type);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        replyText += event.assistantMessageEvent.delta;
      }
    });

    await agent.prompt("Hello!");

    return {
      nodeVersion,
      ok: true,
      eventTypes: [...eventTypes],
      replyText,
    };
  } catch (error) {
    return {
      nodeVersion,
      ok: false,
      eventTypes: [...eventTypes],
      replyText,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}
