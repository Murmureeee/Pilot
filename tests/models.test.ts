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
});

describe("provider connectivity test (FR-5.1)", () => {
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
    } finally {
      fetch.mockRestore();
    }
  });

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
