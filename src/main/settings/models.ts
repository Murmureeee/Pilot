// @env node
import type {
  ModelCapabilities,
  ModelCatalogEntry,
  ModelPricing,
  ProviderFields,
} from "../../shared/contract";
import { modelTokenLimit } from "../../shared/model-capabilities";
import type { Settings } from "./types";

function capabilityFields(entry?: Partial<ModelCapabilities> | null): Partial<ModelCapabilities> {
  const contextWindow = modelTokenLimit(entry?.contextWindow);
  const maxTokens = modelTokenLimit(entry?.maxTokens);
  return {
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(typeof entry?.supportsImages === "boolean" ? { supportsImages: entry.supportsImages } : {}),
    ...(typeof entry?.supportsThinking === "boolean"
      ? { supportsThinking: entry.supportsThinking }
      : {}),
  };
}

function pricingFields(entry?: Partial<ModelPricing> | null): Partial<ModelPricing> {
  const pricing: Partial<ModelPricing> = {};
  for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    const rate = entry?.[field];
    if (typeof rate === "number" && Number.isFinite(rate) && rate >= 0) pricing[field] = rate;
  }
  return pricing;
}

export function normalizeModelCatalog(input: unknown): ModelCatalogEntry[] {
  if (!Array.isArray(input)) return [];
  const models = new Map<string, ModelCatalogEntry>();
  for (const value of input) {
    const entry = value as Partial<ModelCatalogEntry> | null;
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || models.has(id)) continue;
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const overrides = capabilityFields(entry?.overrides);
    const cost = pricingFields(entry?.cost);
    models.set(id, {
      id,
      name: name || id,
      ...capabilityFields(entry),
      ...(Object.keys(cost).length ? { cost } : {}),
      ...(Object.keys(overrides).length ? { overrides } : {}),
    });
  }
  return [...models.values()];
}

export function getProviderModels(
  provider: Pick<ProviderFields, "models" | "modelId">,
): ModelCatalogEntry[] {
  const models = normalizeModelCatalog(provider.models);
  const id = provider.modelId?.trim();
  return models.length || !id ? models : [{ id, name: id }];
}

export function updateActiveModel(
  settings: Settings,
  providerId: string,
  modelId: string,
): Settings {
  const provider = settings.providers.find((entry) => entry.id === settings.activeProviderId);
  if (
    !provider ||
    provider.id !== providerId ||
    !getProviderModels(provider).some(({ id }) => id === modelId)
  ) {
    throw new Error("请从当前提供方已保存的模型中选择。");
  }
  return {
    ...settings,
    providers: settings.providers.map((entry) =>
      entry === provider ? { ...entry, modelId } : entry,
    ),
  };
}
