import { describe, expect, it } from "vitest";
import {
  listModels,
  resolveModel,
  resolveProviderRef,
  testProvider,
} from "../src/main/agent-host/models";
import type { ProviderConfig } from "../src/shared/contract";
import { LOCAL_OPENAI_PRESETS } from "../src/shared/providers";

const fauxCfg: ProviderConfig = {
  id: "f",
  kind: "faux",
  name: "faux",
  modelId: "faux-default",
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
