// @env browser
import type {
  ModelCapabilities,
  ModelCatalogEntry,
  ProviderInput,
  ProviderKind,
} from "@shared/contract";

export interface DraftModel extends ModelCatalogEntry {
  automatic?: ModelCapabilities;
}

export interface DraftProvider {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  modelId: string;
  models: DraftModel[];
  hasKey: boolean;
  apiKeyInput: string;
}

export type ModelCatalogState =
  | { state: "loading" }
  | { state: "loaded"; models: ModelCatalogEntry[] }
  | { state: "error"; error: string };

export interface ModelCatalogDialogProps {
  catalog: ModelCatalogState;
  savedModels: readonly DraftModel[];
  onApply(models: DraftModel[]): void;
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
