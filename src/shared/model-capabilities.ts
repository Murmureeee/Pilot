// @env all
import type { ModelCapabilities } from "./contract";

export function modelTokenLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function effectiveModelCapabilities(
  automatic: ModelCapabilities,
  overrides?: Partial<ModelCapabilities>,
): ModelCapabilities {
  const contextWindow = overrides?.contextWindow ?? automatic.contextWindow;
  return {
    contextWindow,
    maxTokens: Math.min(overrides?.maxTokens ?? automatic.maxTokens, contextWindow),
    supportsImages: overrides?.supportsImages ?? automatic.supportsImages,
    supportsThinking: overrides?.supportsThinking ?? automatic.supportsThinking,
  };
}
