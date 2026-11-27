import type { TranscriptContext } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
  listModels,
  resolveModel,
  resolveProviderRef,
  testProvider,
} from "../src/main/agent-host/models";
import type { ProviderConfig } from "../src/main/settings/types";
import { LOCAL_OPENAI_PRESETS } from "../src/shared/providers";

const fauxCfg: ProviderConfig = {
  id: "f",
  kind: "faux",
  name: "faux",
  modelId: "faux-default",
};

const responsesCfg: ProviderConfig = {
  id: "responses",
  kind: "openai-responses",
  name: "Responses endpoint",
  baseUrl: "https://example.test/v1",
  modelId: "test-model",
};

describe("model catalog (FR-5.2)", () => {
  it("normalizes explicit endpoint capability data and per-token catalog pricing", async () => {
    using request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: [
          {
            id: "vision",
            name: "Vision",
            context_length: 32_768,
            top_provider: { max_completion_tokens: 4096 },
            architecture: { input_modalities: ["text", "image"] },
            supported_parameters: ["reasoning"],
            pricing: { prompt: "0.0000015", completion: "0.000003", input_cache_read: "-1" },
            overrides: { maxTokens: 9999 },
          },
          {
            id: "text",
            context_window: -1,
            max_output_tokens: 1.5,
            supports_images: false,
            supports_thinking: false,
          },
          { id: "legacy" },
        ],
      }),
    );
    const entries = await listModels(responsesCfg, undefined);
    expect(entries).toEqual([
      {
        id: "vision",
        name: "Vision",
        contextWindow: 32_768,
        maxTokens: 4096,
        supportsImages: true,
        supportsThinking: true,
        cost: { input: 1.5, output: 3 },
      },
      { id: "text", name: "text", supportsImages: false, supportsThinking: false },
      { id: "legacy", name: "legacy" },
    ]);
    expect(request).toHaveBeenCalledOnce();
  });

  it("lists the faux model", async () => {
    const list = await listModels(fauxCfg, undefined);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("faux-default");
  });

  it("lists anthropic models from the pi-ai catalog (offline)", async () => {
    const cfg: ProviderConfig = {
      id: "a",
      kind: "anthropic",
      name: "a",
      modelId: "claude-sonnet-4-6",
    };
    const list = await listModels(cfg, "unused-key-for-catalog");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((m) => m.id.length > 0 && m.name.length > 0)).toBe(true);
    expect(list.some((m) => (m.contextWindow ?? 0) > 0)).toBe(true);
  });

  it("requires baseUrl for openai-compatible catalog", async () => {
    const cfg: ProviderConfig = { id: "o", kind: "openai-compatible", name: "o", modelId: "q" };
    await expect(listModels(cfg, "k")).rejects.toThrow(/baseUrl/);
  });

  it("reads a Responses provider catalog without duplicates, invalid IDs or echoed secrets", async () => {
    using fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        data: [
          { id: "first", name: "First model" },
          { id: "first", name: "Duplicate" },
          { id: "second" },
          { id: " " },
          { id: "test-catalog-key" },
          { id: "private", name: "test-catalog-key" },
        ],
      }),
    );
    await expect(listModels(responsesCfg, "test-catalog-key")).resolves.toEqual([
      { id: "first", name: "First model" },
      { id: "second", name: "second" },
    ]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://example.test/v1/models", {
      headers: { Authorization: "Bearer test-catalog-key" },
      signal: expect.any(AbortSignal),
    });
  });
});

describe("provider connectivity test (FR-5.1)", () => {
  it("applies output, image and thinking capabilities to the compatible request", async () => {
    const cfg: ProviderConfig = {
      ...responsesCfg,
      kind: "openai-compatible",
      modelId: "vision",
      models: [
        {
          id: "vision",
          name: "Vision",
          contextWindow: 32_768,
          maxTokens: 4096,
          supportsImages: true,
          supportsThinking: false,
          cost: { input: 1.5 },
          overrides: { maxTokens: 320, supportsThinking: true },
        },
      ],
    };
    const { model, streamFn } = resolveModel(cfg, "test-key");
    expect(model).toMatchObject({
      contextWindow: 32_768,
      maxTokens: 320,
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 1.5 },
    });
    const context = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "ping" },
            { type: "image", mimeType: "image/png", data: "AA==" },
          ],
          timestamp: 0,
        },
      ],
    } as TranscriptContext;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: { message: "Fixture end" } }, { status: 400 }),
    );
    const stream = await streamFn(model, context, { fetch, reasoning: "medium", maxRetries: 0 });
    await stream.result();
    const request = new Request(...fetch.mock.calls[0]);
    expect(await request.json()).toMatchObject({
      max_completion_tokens: 320,
      reasoning_effort: "medium",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "ping" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
          ],
        },
      ],
    });
  });

  it("uses Pi reasoning metadata for a known Responses model", () => {
    const { model } = resolveModel({ ...responsesCfg, modelId: "gpt-6.1-terra" }, "test-key");
    expect(model.reasoning).toBe(true);
    expect(model.thinkingLevelMap?.max).toBe("max");
  });
  it("streams Responses text over the configured endpoint with a bounded output", async () => {
    const { model, streamFn } = resolveModel(responsesCfg, "test-key");
    const context = {
      messages: [{ role: "user", content: "ping", timestamp: 0 }],
    } as TranscriptContext;
    const events = [
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: "msg_1", type: "message", role: "assistant", content: [] },
      },
      { type: "response.output_text.delta", output_index: 0, delta: "pong" },
      {
        type: "response.completed",
        response: { id: "resp_1", status: "completed", output: [] },
      },
    ];
    const body = events
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join("");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    );
    const stream = await streamFn(model, context, { fetch, maxTokens: 1, maxRetries: 0 });
    const deltas: string[] = [];
    for await (const event of stream) {
      if (event.type === "text_delta") deltas.push(event.delta);
    }
    const result = await stream.result();

    expect(result.stopReason).toBe("stop");
    expect(deltas).toEqual(["pong"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = new Request(...fetch.mock.calls[0]);
    expect(request.url).toBe("https://example.test/v1/responses");
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe("Bearer test-key");
    expect(await request.json()).toMatchObject({
      model: "test-model",
      stream: true,
      store: false,
      max_output_tokens: 16,
    });
  });

  it("reports a provider error with the key redacted and does not retry", async () => {
    using timeout = vi.spyOn(AbortSignal, "timeout");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ error: { message: "Rejected test-key" } }, { status: 429 }),
      );
    try {
      const result = await testProvider(responsesCfg, "test-key");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Rejected ••••");
      expect(result.error).not.toContain("test-key");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(20_000);
    } finally {
      fetch.mockRestore();
    }
  });

  it.each(LOCAL_OPENAI_PRESETS)(
    "allows $name to load the model on the first connection test",
    async ({ baseUrl }) => {
      using timeout = vi.spyOn(AbortSignal, "timeout");
      const provider: ProviderConfig = {
        id: "compatible",
        kind: "openai-compatible",
        name: "Compatible endpoint",
        modelId: "local-model",
        baseUrl,
      };
      const request = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ error: { message: "Model not found" } }, { status: 404 }),
      );

      await testProvider(provider, undefined, request);

      expect(request).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(60_000);
    },
  );

  it("accepts local endpoints without credentials and requires keys for remote compatible endpoints", () => {
    const provider: ProviderConfig = {
      id: "compatible",
      kind: "openai-compatible",
      name: "Compatible endpoint",
      modelId: "local-model",
    };
    for (const { baseUrl } of LOCAL_OPENAI_PRESETS) {
      expect(resolveModel({ ...provider, baseUrl }, undefined).model.baseUrl).toBe(baseUrl);
    }
    expect(() =>
      resolveModel({ ...provider, baseUrl: "https://example.test/v1" }, undefined),
    ).toThrow(/API key/);
  });

  it("reuses a saved key only for previews of the same provider endpoint", () => {
    const saved: ProviderConfig = {
      id: "compatible",
      kind: "openai-compatible",
      name: "compatible",
      modelId: "model-a",
      baseUrl: "https://example.test/v1",
      apiKey: "encrypted",
    };
    const { apiKey: _apiKey, ...draft } = saved;
    const find = (id: string): ProviderConfig | undefined => (id === saved.id ? saved : undefined);
    const read = (key: string | undefined): string | undefined =>
      key === "encrypted" ? "test-key" : undefined;

    expect(resolveProviderRef(saved.id, find, read).key).toBe("test-key");
    expect(resolveProviderRef({ ...draft, modelId: "model-b" }, find, read).key).toBe("test-key");
    const newEndpoint = { ...draft, baseUrl: "https://other.test/v1" };
    expect(resolveProviderRef(newEndpoint, find, read).key).toBeUndefined();
    expect(resolveProviderRef({ ...newEndpoint, apiKey: "draft-key" }, find, read).key).toBe(
      "draft-key",
    );
  });

  it("faux provider passes with latency reported", async () => {
    const result = await testProvider(fauxCfg, undefined);
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("anthropic without a key reports failure instead of throwing", async () => {
    const cfg: ProviderConfig = {
      id: "a",
      kind: "anthropic",
      name: "a",
      modelId: "claude-sonnet-4-6",
    };
    const result = await testProvider(cfg, undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/API key/);
  });
});
