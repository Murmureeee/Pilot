// @env browser
import type { ModelCatalogEntry, ProviderInput, ProviderKind } from "@shared/contract";

export interface DraftProvider {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  modelId: string;
  models: ModelCatalogEntry[];
  hasKey: boolean;
  apiKeyInput: string;
}

export type ModelCatalogState =
  | { state: "loading" }
  | { state: "loaded"; models: ModelCatalogEntry[] }
  | { state: "error"; error: string };

export interface ModelCatalogDialogProps {
  catalog: ModelCatalogState;
  savedModels: readonly ModelCatalogEntry[];
  onAdd(models: ModelCatalogEntry[]): void;
  onClose(): void;
}

export interface ProviderEditorProps {
  draft: DraftProvider;
  active: boolean;
  toInput(draft: DraftProvider): ProviderInput;
  onChange(patch: Partial<DraftProvider>): void;
  onActivate(): void;
  onRemove(): void;
}
