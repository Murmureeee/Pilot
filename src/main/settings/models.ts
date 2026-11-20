// @env node
import type { ModelCatalogEntry, ProviderFields } from "../../shared/contract";
import type { Settings } from "./types";

export function normalizeModelCatalog(input: unknown): ModelCatalogEntry[] {
  if (!Array.isArray(input)) return [];
  const models = new Map<string, ModelCatalogEntry>();
  for (const value of input) {
    const entry = value as Partial<ModelCatalogEntry> | null;
    const id = typeof entry?.id === "string" ? entry.id.trim() : "";
    if (!id || models.has(id)) continue;
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    const contextWindow = entry?.contextWindow;
    models.set(id, {
      id,
      name: name || id,
      ...(typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
        ? { contextWindow }
        : {}),
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
