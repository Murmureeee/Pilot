// @env all
import type { ProviderInput, ProviderKind, SessionModelSelection } from "./contract";

export const LOCAL_OPENAI_PRESETS = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

export function isOpenAiProvider(kind: ProviderKind): boolean {
  return kind === "openai-compatible" || kind === "openai-responses";
}

export function isLocalOpenAiProvider(provider: Pick<ProviderInput, "kind" | "baseUrl">): boolean {
  if (!isOpenAiProvider(provider.kind) || !provider.baseUrl) return false;
  const url = URL.parse(provider.baseUrl);
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}

export function hasSavedModel(
  providers: readonly Pick<ProviderInput, "id" | "models" | "modelId">[],
  selection: SessionModelSelection,
): boolean {
  const provider = providers.find(({ id }) => id === selection.providerId);
  return Boolean(
    provider &&
    (provider.models?.length
      ? provider.models.some(({ id }) => id === selection.modelId)
      : provider.modelId === selection.modelId),
  );
}

export function resolveSessionModel(
  settings: {
    providers: readonly Pick<ProviderInput, "id" | "models" | "modelId">[];
    activeProviderId: string;
  },
  selection?: SessionModelSelection,
): SessionModelSelection | undefined {
  if (selection && hasSavedModel(settings.providers, selection)) return selection;
  const provider = settings.providers.find(({ id }) => id === settings.activeProviderId);
  if (provider?.modelId) return { providerId: provider.id, modelId: provider.modelId };
  return undefined;
}
