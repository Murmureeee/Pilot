// @env node
// 把 Provider 配置解析为可用的 (model, streamFn)。
// 直连 pi-ai 的 API 实现模块（绕过 provider 凭据体系），apiKey 由本应用注入 —— 见 pi-ai README「Calling API Implementations Directly」。
import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type Api,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { streamSimple as anthropicStreamSimple } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as chatCompletionsStreamSimple } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as responsesStreamSimple } from "@earendil-works/pi-ai/api/openai-responses";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

import type { ModelCatalogEntry, ProviderInput, ProviderTestResult } from "@shared/contract";

import { visibleMessageText } from "../../shared/mentions";
import { isLocalOpenAiProvider } from "../../shared/providers";
import { normalizeModelCatalog } from "../settings/models";
import type { ProviderConfig } from "../settings/types";
import { legacyMentionParts } from "./mentions";
import { messageText } from "./session-store";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";

export interface ResolvedModel {
  model: Model<Api>;
  streamFn: StreamFn;
}

function resolveFaux(): ResolvedModel {
  // 60 tok/s 限速让流式渲染肉眼可见；每次请求按上下文补一条脚本响应（faux 队列为空会报错）
  const faux = fauxProvider({ tokensPerSecond: 60 });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  if (!model) throw new Error("faux model 不可用");

  const inner = models.streamSimple.bind(models);
  const streamFn: StreamFn = (m, context, options) => {
    const messages = context.messages ?? [];
    const last = messages.at(-1) as AgentMessage | undefined;
    const lastUser = messages.findLast((message) => message.role === "user");
    const text = lastUser ? messageText(lastUser) : "（空输入）";
    const withoutSkillBodies = text.split("\n\n## Skills selected for this request\n\n", 1)[0];
    const parts = legacyMentionParts(withoutSkillBodies);
    const echoed = (parts ? visibleMessageText(parts) : text).slice(0, 200);
    const chinese = /\p{Script=Han}/u.test(echoed);

    // 工具结果回填后的收尾响应
    if (last?.role === "toolResult") {
      if (last.toolName === PLAN_TOOL_NAME) {
        const steps = readPlanSteps(last.details);
        if (steps?.some((step) => step.status !== "completed")) {
          faux.appendResponses([
            fauxAssistantMessage(
              [
                fauxToolCall(PLAN_TOOL_NAME, {
                  steps: steps.map((step) => ({ ...step, status: "completed" })),
                }),
              ],
              { stopReason: "toolUse" },
            ),
          ]);
        } else {
          faux.appendResponses([
            fauxAssistantMessage([
              fauxText(chinese ? "任务计划演示结束。" : "The task plan demo is complete."),
            ]),
          ]);
        }
        return inner(m, context, options);
      }
      const errorText = last.isError
        ? chinese
          ? "（该调用被拒绝或失败）"
          : "The call was denied or failed."
        : "";
      faux.appendResponses([
        fauxAssistantMessage([
          fauxText(
            chinese ? `**工具演示结束** ${errorText}` : `**Tool demo complete.** ${errorText}`,
          ),
        ]),
      ]);
      return inner(m, context, options);
    }

    if (/计划演示|plan demo/i.test(echoed)) {
      faux.appendResponses([
        fauxAssistantMessage(
          [
            fauxToolCall(PLAN_TOOL_NAME, {
              steps: [
                { title: chinese ? "整理任务步骤" : "Outline the steps", status: "in_progress" },
                { title: chinese ? "更新完成状态" : "Update completion status", status: "pending" },
              ],
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);
      return inner(m, context, options);
    }

    // 触发词「演示 / demo」覆盖思考流、工具授权和文件变更。
    if (/演示|demo/i.test(echoed)) {
      faux.appendResponses([
        fauxAssistantMessage(
          [
            fauxThinking(
              chinese
                ? "先在工作目录写入演示文件，再确认工具返回与文件差异。"
                : "Write the demo file in the workspace, then check the tool result and file changes.",
            ),
            fauxToolCall("write_file", {
              path: "pilot-demo.txt",
              content: "由 faux 工具演示写入\n时间戳占位",
            }),
          ],
          { stopReason: "toolUse" },
        ),
      ]);
      return inner(m, context, options);
    }

    faux.appendResponses([
      fauxAssistantMessage([
        fauxText(
          chinese
            ? `（faux 演示回复）你说的是：「${echoed}」。\n\n发送 **演示** 可体验工具调用，发送 **计划演示** 可查看任务计划。`
            : `(Faux demo) You said: “${echoed}”\n\nSend **demo** to try a tool call or **plan demo** to see a task plan.`,
        ),
      ]),
    ]);
    return inner(m, context, options);
  };
  return { model, streamFn };
}

function resolveAnthropic(cfg: ProviderConfig, apiKey: string): ResolvedModel {
  const models = createModels();
  models.setProvider(anthropicProvider());
  const model = models.getModel("anthropic", cfg.modelId);
  if (!model) throw new Error(`未知 anthropic 模型: ${cfg.modelId}`);
  const streamFn: StreamFn = (m, context, options) =>
    anthropicStreamSimple(m as Model<"anthropic-messages">, context, { ...options, apiKey });
  return { model, streamFn };
}

function resolveOpenAi(cfg: ProviderConfig, apiKey: string): ResolvedModel {
  const baseUrl = cfg.baseUrl?.trim();
  if (!baseUrl) throw new Error("OpenAI 端点必须提供 baseUrl");
  const common: Omit<Model<Api>, "api" | "compat"> = {
    id: cfg.modelId,
    name: cfg.modelId,
    provider: cfg.id,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
  if (cfg.kind === "openai-responses") {
    const models = createModels();
    models.setProvider(openaiProvider());
    const known = models.getModel("openai", cfg.modelId);
    const model: Model<"openai-responses"> = {
      ...common,
      api: "openai-responses",
      reasoning: known?.reasoning ?? false,
      thinkingLevelMap: known?.thinkingLevelMap,
      compat: { supportsDeveloperRole: false },
    };
    const streamFn: StreamFn = (m, context, options) =>
      responsesStreamSimple(m as Model<"openai-responses">, context, { ...options, apiKey });
    return { model, streamFn };
  }
  const model: Model<"openai-completions"> = {
    ...common,
    api: "openai-completions",
    compat: {
      // Ollama / vLLM / 中转站等兼容端普遍不支持 developer 角色与 reasoning_effort
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
  const streamFn: StreamFn = (m, context, options) =>
    chatCompletionsStreamSimple(m as Model<"openai-completions">, context, {
      ...options,
      apiKey,
    });
  return { model, streamFn };
}

/**
 * 解析 catalog/test 的目标：字符串 = 已保存 provider id（key 从存储解密）；
 * 对象 = 未保存的草稿（FR-5.7 向导用，apiKey 为用户刚输入的明文）。
 */
export function resolveProviderRef(
  ref: string | ProviderInput,
  findSaved: (id: string) => ProviderConfig | undefined,
  readKey: (stored: string | undefined) => string | undefined,
): { cfg: ProviderConfig; key: string | undefined } {
  if (typeof ref === "string") {
    const saved = findSaved(ref);
    if (!saved) throw new Error(`provider 不存在: ${ref}`);
    return { cfg: saved, key: readKey(saved.apiKey) };
  }
  if (!ref || typeof ref !== "object" || !ref.kind) {
    throw new Error("invalid provider draft");
  }
  const draftKey = typeof ref.apiKey === "string" && ref.apiKey.length > 0 ? ref.apiKey : undefined;
  const saved = typeof ref.id === "string" ? findSaved(ref.id) : undefined;
  // 从草稿测试新端点时，只能使用本次输入的 key。
  const key =
    draftKey ??
    (saved?.kind === ref.kind && saved.baseUrl?.trim() === ref.baseUrl?.trim()
      ? readKey(saved.apiKey)
      : undefined);
  return {
    cfg: { ...ref, apiKey: undefined },
    key,
  };
}

export function resolveModel(cfg: ProviderConfig, apiKey: string | undefined): ResolvedModel {
  switch (cfg.kind) {
    case "faux":
      return resolveFaux();
    case "anthropic":
      if (!apiKey) throw new Error("anthropic provider 未配置 API key");
      return resolveAnthropic(cfg, apiKey);
    case "openai-compatible":
    case "openai-responses": {
      // The OpenAI client requires a nonempty key even for servers with authentication disabled.
      const key = apiKey || (isLocalOpenAiProvider(cfg) ? "local" : undefined);
      if (!key) throw new Error("OpenAI 端点未配置 API key");
      return resolveOpenAi(cfg, key);
    }
    default:
      throw new Error(`未知 provider kind: ${String(cfg.kind)}`);
  }
}

/** 模型目录（FR-5.2）：Anthropic 走 pi-ai catalog；OpenAI 兼容端点探测 GET /models。 */
export async function listModels(
  cfg: ProviderConfig,
  apiKey: string | undefined,
): Promise<ModelCatalogEntry[]> {
  switch (cfg.kind) {
    case "faux":
      return [{ id: "faux-default", name: "Faux 演示（无需 key）" }];
    case "anthropic": {
      const models = createModels();
      models.setProvider(anthropicProvider());
      return models
        .getModels("anthropic")
        .map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
    }
    case "openai-compatible":
    case "openai-responses": {
      const baseUrl = cfg.baseUrl?.trim();
      if (!baseUrl) throw new Error("OpenAI 端点必须提供 baseUrl");
      const url = `${baseUrl.replace(/\/+$/, "")}/models`;
      const response = await fetch(url, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`获取模型目录失败：HTTP ${response.status}`);
      }
      const json = (await response.json()) as { data?: unknown } | null;
      const entries = normalizeModelCatalog(Array.isArray(json) ? json : json?.data).filter(
        ({ id, name }) => !apiKey || (!id.includes(apiKey) && !name.includes(apiKey)),
      );
      if (entries.length === 0) throw new Error("端点返回了空模型目录");
      return entries;
    }
    default:
      throw new Error(`未知 provider kind: ${String(cfg.kind)}`);
  }
}

/** 连通性测试（FR-5.1）使用最小流式请求，并关闭自动重试。 */
export async function testProvider(
  cfg: ProviderConfig,
  apiKey: string | undefined,
): Promise<ProviderTestResult> {
  const startedAt = Date.now();
  try {
    const { model, streamFn } = resolveModel(cfg, apiKey);
    // TranscriptContext 带 brand，只能断言构造
    const context = {
      messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
    } as TranscriptContext;
    const stream = await streamFn(model, context, {
      maxTokens: 1,
      maxRetries: 0,
      signal: AbortSignal.timeout(20_000),
    });
    for await (const event of stream) {
      if (event.type === "error") {
        throw new Error(event.error.errorMessage ?? "流式请求失败");
      }
    }
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: apiKey ? message.replaceAll(apiKey, "••••") : message,
      latencyMs: Date.now() - startedAt,
    };
  }
}
