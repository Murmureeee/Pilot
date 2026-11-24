// @env node
import { setTimeout as wait } from "node:timers/promises";

import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  isContextOverflow,
  isRetryableAssistantError,
  retryDelayMs,
  type AssistantMessage,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";

import type { ModelFailure } from "@shared/contract";

import { MODEL_ERROR_DETAIL_LIMIT, MODEL_RETRY_ATTEMPTS, MODEL_RETRY_POLICY } from "./constants";
import type { ModelRetryCallbacks } from "./types";

function failureKind(result: AssistantMessage, status?: number): ModelFailure["kind"] {
  const detail = result.errorMessage ?? "";
  if (
    status === 402 ||
    /insufficient[_ -](?:quota|credits|balance)|quota (?:exceeded|exhausted)|billing|out of budget|available balance|monthly usage limit|(?:Go|Free)UsageLimitError|subscription_sharing_\w+_limit_exceeded|"code"\s*:\s*"?1308\b/i.test(
      detail,
    )
  )
    return "quota";
  if (status === 401 || /invalid[_ -]api[_ -]key|authentication_error|unauthorized/i.test(detail))
    return "credentials";
  if (
    status === 404 ||
    isContextOverflow(result) ||
    /model_not_found|unsupported_(?:model|parameter|value)|(?:model|model id).{0,80}(?:not found|does not exist|not supported)|(?:does not support|unsupported).{0,50}(?:tools|reasoning|vision|images|parameters)/i.test(
      detail,
    )
  )
    return "capability";
  if (status === 403 || /permission_error|invalid credentials/i.test(detail)) return "credentials";
  if (status === 429 || /rate.?limit|too many requests/i.test(detail)) return "rate-limit";
  if (
    (status !== undefined && status >= 500 && status < 600) ||
    /overloaded|server.?(?:busy|error)|service.?(?:temporarily.?)?unavailable/i.test(detail)
  )
    return "server";
  if (
    status === 408 ||
    ((status === undefined || status < 400) && isRetryableAssistantError(result))
  )
    return "network";
  return "other";
}

function retryAfterMs(value: string | null): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms)) : 0;
}

function errorDetail(message: string | undefined, apiKey: string | undefined): string {
  const detail = message?.trim() || "模型返回错误";
  const redacted = apiKey ? detail.replaceAll(apiKey, "••••") : detail;
  return redacted.length > MODEL_ERROR_DETAIL_LIMIT
    ? redacted.slice(0, MODEL_ERROR_DETAIL_LIMIT) + "…"
    : redacted;
}

export function withModelRetry(streamFn: StreamFn, callbacks: ModelRetryCallbacks): StreamFn {
  return (model, context, options) => {
    const request = options?.fetch ?? globalThis.fetch;
    const signal = options?.signal;

    async function* readAttempts(): AsyncGenerator<AssistantMessageEvent, AssistantMessage> {
      let started = false;
      let retrying = false;
      try {
        for (let attempt = 1; ; attempt++) {
          signal?.throwIfAborted();
          let status: number | undefined;
          let retryAfter: string | null = null;
          const stream = await streamFn(model, context, {
            ...options,
            maxRetries: 0,
            fetch: async (...args) => {
              const response = await request(...args);
              status = response.status;
              retryAfter = response.headers.get("retry-after");
              return response;
            },
          });
          for await (const event of stream) {
            if (event.type === "error" || event.type === "done") break;
            // Pi appends a transcript entry for each start event. All attempts share one entry.
            if (event.type === "start") {
              if (started) continue;
              started = true;
            }
            yield event;
          }

          const result = await stream.result();
          if (result.stopReason === "aborted" || signal?.aborted) {
            return {
              ...result,
              stopReason: "aborted",
              content: result.content.filter((part) => part.type !== "toolCall"),
              errorMessage: undefined,
            };
          }
          if (result.stopReason !== "error") return result;

          const kind = failureKind(result, status);
          const transient = kind === "network" || kind === "rate-limit" || kind === "server";
          const delay = Math.max(
            retryDelayMs(MODEL_RETRY_POLICY, attempt),
            retryAfterMs(retryAfter),
          );
          if (
            !transient ||
            attempt > MODEL_RETRY_ATTEMPTS ||
            delay > MODEL_RETRY_POLICY.maxAgentDelayMs
          ) {
            const detail = errorDetail(result.errorMessage, options?.apiKey);
            callbacks.onFailure({ kind, detail });
            return { ...result, content: [], errorMessage: detail };
          }

          retrying = true;
          const progress = {
            attempt,
            maxAttempts: MODEL_RETRY_ATTEMPTS,
            retryAt: Date.now() + delay,
          };
          callbacks.onRetry(progress);
          await wait(delay, undefined, { signal });
          signal?.throwIfAborted();
          callbacks.onRetry({ ...progress, retryAt: null });
        }
      } catch (error) {
        const aborted = signal?.aborted === true;
        const detail = aborted
          ? undefined
          : errorDetail(error instanceof Error ? error.message : String(error), options?.apiKey);
        if (detail) callbacks.onFailure({ kind: "other", detail });
        return {
          role: "assistant",
          api: model.api,
          provider: model.provider,
          model: model.id,
          timestamp: Date.now(),
          content: [],
          stopReason: aborted ? "aborted" : "error",
          errorMessage: detail,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        };
      } finally {
        if (retrying) callbacks.onRetry(null);
      }
    }

    const output = createAssistantMessageEventStream();
    // Pull the next event only after Pi has applied the previous one to the visible reply.
    output[Symbol.asyncIterator] = async function* (): AsyncGenerator<AssistantMessageEvent> {
      output.end(yield* readAttempts());
    };
    return output;
  };
}
