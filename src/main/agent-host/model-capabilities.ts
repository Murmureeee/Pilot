// @env node
import { createModels, fauxProvider, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

import type { ModelCapabilities, ModelCatalogEntry, ProviderFields } from "@shared/contract";

import { OPENAI_RESPONSES_MIN_TOKENS } from "../../shared/constants";
import { effectiveModelCapabilities, modelTokenLimit } from "../../shared/model-capabilities";
import { normalizeModelCatalog } from "../settings/models";
import { DEFAULT_MODEL_CAPABILITIES } from "./constants";

const catalog = createModels();
catalog.setProvider(anthropicProvider());
catalog.setProvider(openaiProvider());
const demoModel = fauxProvider().getModel();

function directOpenAi(provider: ProviderFields): boolean {
  return Boolean(
    provider.baseUrl && URL.parse(provider.baseUrl)?.origin === "https://api.openai.com",
  );
}

export function bundledModel(
  provider: ProviderFields,
  id = provider.modelId,
): Model<Api> | undefined {
  if (provider.kind === "faux") return demoModel;
  if (provider.kind === "anthropic") return catalog.getModel("anthropic", id);
  if (provider.kind === "openai-responses" || directOpenAi(provider))
    return catalog.getModel("openai", id);
}

export function capabilitiesFromModel(model: Model<Api>): ModelCapabilities {
  return {
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    supportsImages: model.input.includes("image"),
    supportsThinking: model.reasoning,
  };
}

export function automaticModelCapabilities(
  provider: ProviderFields,
  entry?: ModelCatalogEntry,
): ModelCapabilities {
  const fallback = bundledModel(provider, entry?.id);
  const defaults = fallback ? capabilitiesFromModel(fallback) : DEFAULT_MODEL_CAPABILITIES;
  const minimum = provider.kind === "openai-responses" ? OPENAI_RESPONSES_MIN_TOKENS : 1;
  return {
    contextWindow:
      entry?.contextWindow && entry.contextWindow >= minimum
        ? entry.contextWindow
        : defaults.contextWindow,
    maxTokens:
      entry?.maxTokens && entry.maxTokens >= minimum ? entry.maxTokens : defaults.maxTokens,
    supportsImages: entry?.supportsImages ?? defaults.supportsImages,
    supportsThinking: entry?.supportsThinking ?? defaults.supportsThinking,
  };
}

export function applyModelCapabilities<TApi extends Api>(
  provider: ProviderFields,
  model: Model<TApi>,
): Model<TApi> {
  const entry = provider.models?.find(({ id }) => id === provider.modelId);
  const capabilities = effectiveModelCapabilities(
    automaticModelCapabilities(provider, entry),
    entry?.overrides,
  );
  const input = model.input.filter((modality) => modality !== "image");
  return {
    ...model,
    contextWindow: capabilities.contextWindow,
    maxTokens: capabilities.maxTokens,
    input: capabilities.supportsImages ? [...input, "image"] : input,
    reasoning: capabilities.supportsThinking,
    cost: { ...model.cost, ...entry?.cost },
  };
}

export function bundledModelEntries(provider: ProviderFields): ModelCatalogEntry[] {
  const models =
    provider.kind === "anthropic" ? catalog.getModels("anthropic") : demoModel ? [demoModel] : [];
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    ...capabilitiesFromModel(model),
    cost: model.cost,
  }));
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstLimit(...values: unknown[]): number | undefined {
  return values.map(modelTokenLimit).find((value) => value !== undefined);
}

function firstFlag(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

function pricePerMillion(value: unknown): number | undefined {
  const rate = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof rate === "number" && Number.isFinite(rate * 1_000_000) && rate >= 0
    ? rate * 1_000_000
    : undefined;
}

export function normalizeEndpointModels(input: unknown): ModelCatalogEntry[] {
  if (!Array.isArray(input)) return [];
  return normalizeModelCatalog(
    input.map((value: unknown) => {
      const entry = fields(value);
      const architecture = fields(entry.architecture);
      const topProvider = fields(entry.top_provider);
      const capabilities = fields(entry.capabilities);
      const modalities = [entry.input, entry.input_modalities, architecture.input_modalities].find(
        Array.isArray,
      );
      const parameters = Array.isArray(entry.supported_parameters)
        ? entry.supported_parameters
        : [];
      const pricing = fields(entry.pricing);
      const cost = fields(entry.cost);
      return {
        id: entry.id,
        name: entry.name,
        contextWindow: firstLimit(
          entry.contextWindow,
          entry.context_window,
          entry.context_length,
          topProvider.context_length,
        ),
        maxTokens: firstLimit(
          entry.maxTokens,
          entry.max_output_tokens,
          entry.max_completion_tokens,
          entry.max_tokens,
          topProvider.max_completion_tokens,
        ),
        supportsImages: firstFlag(
          entry.supportsImages,
          entry.supports_images,
          entry.supports_vision,
          capabilities.vision,
          modalities?.includes("image"),
        ),
        supportsThinking: firstFlag(
          entry.supportsThinking,
          entry.supports_thinking,
          entry.reasoning,
          capabilities.reasoning,
          parameters.some(
            (parameter) => parameter === "reasoning" || parameter === "reasoning_effort",
          ) || undefined,
        ),
        cost: {
          input: cost.input ?? pricePerMillion(pricing.prompt),
          output: cost.output ?? pricePerMillion(pricing.completion),
          cacheRead: cost.cacheRead ?? pricePerMillion(pricing.input_cache_read),
          cacheWrite: cost.cacheWrite ?? pricePerMillion(pricing.input_cache_write),
        },
      };
    }),
  );
}

export function bundledOpenAiPricing(provider: ProviderFields): Model<Api>["cost"] | undefined {
  return directOpenAi(provider) ? bundledModel(provider)?.cost : undefined;
}
