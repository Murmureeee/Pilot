// @env browser
import { cn } from "cn";
import { CheckIcon, DownloadIcon, PlusIcon, TrashIcon, XIcon } from "lucide-react";
import { useId, useRef, useState, type JSX } from "react";

import { LocalProviderPresets } from "@renderer/components/ai/local-provider-presets";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { PROVIDER_KIND_LABELS } from "@renderer/lib/constants";
import { displayProviderName, localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { ModelCatalogEntry, ProviderKind, ProviderTestResult } from "@shared/contract";
import { isLocalOpenAiProvider, isOpenAiProvider } from "@shared/providers";

import { ModelCatalogDialog } from "./ModelCatalogDialog";
import type { DraftProvider, ModelCatalogState, ProviderEditorProps } from "./types";

export function ProviderEditor({
  draft,
  active,
  toInput,
  onChange,
  onActivate,
  onRemove,
}: ProviderEditorProps): JSX.Element {
  const locale = useLocale();
  const uid = useId();
  const [modelInput, setModelInput] = useState("");
  const [catalog, setCatalog] = useState<ModelCatalogState | null>(null);
  const [test, setTest] = useState<ProviderTestResult | "loading" | null>(null);
  const testRequest = useRef(0);
  const openAi = isOpenAiProvider(draft.kind);
  const inputId = modelInput.trim();
  const canAdd = Boolean(inputId && !draft.models.some(({ id }) => id === inputId));

  const changeConnection = (patch: Partial<DraftProvider>): void => {
    testRequest.current += 1;
    setTest(null);
    onChange(patch);
  };

  const replaceModels = (models: ModelCatalogEntry[]): void => {
    changeConnection({
      models,
      modelId: models.find(({ id }) => id === draft.modelId)?.id ?? models[0]?.id ?? "",
    });
  };

  const addManualModel = (): void => {
    if (!canAdd) return;
    replaceModels([...draft.models, { id: inputId, name: inputId }]);
    setModelInput("");
  };

  const showCatalog = async (): Promise<void> => {
    const loading = { state: "loading" } as const;
    setCatalog(loading);
    try {
      const models = await window.pi.modelCatalog(toInput(draft));
      setCatalog((current) => (current === loading ? { state: "loaded", models } : current));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCatalog((current) => (current === loading ? { state: "error", error: message } : current));
    }
  };

  const testConnection = async (): Promise<void> => {
    const request = ++testRequest.current;
    setTest("loading");
    try {
      const result = await window.pi.testProvider(toInput(draft));
      if (testRequest.current === request) setTest(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (testRequest.current === request) {
        setTest({ ok: false, error: message, latencyMs: 0 });
      }
    }
  };

  return (
    <section className="settings-card" aria-labelledby={uid + "-heading"}>
      <div className="settings-row gap-x-3">
        <h2 id={uid + "-heading"} className="min-w-0 flex-1 truncate text-sm font-medium">
          {displayProviderName(draft, locale) || t("新提供方", locale)}
        </h2>
        <div className="flex items-center gap-1.5">
          {!active && (
            <Button variant="outline" size="sm" disabled={!draft.modelId} onClick={onActivate}>
              {t("设为当前提供方", locale)}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={t("删除提供方", locale)}
            title={t("删除提供方", locale)}
            onClick={onRemove}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>
      <div className="grid gap-3.5 p-4">
        <div className="settings-fields">
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            {t("名称", locale)}
            <Input
              value={draft.name}
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <label htmlFor={uid + "-type"}>{t("类型", locale)}</label>
            <Select
              value={draft.kind}
              onValueChange={(kind: ProviderKind | null) => {
                if (kind && kind !== draft.kind) changeConnection({ kind });
              }}
            >
              <SelectTrigger id={uid + "-type"} className="w-full min-w-0">
                <SelectValue>{t(PROVIDER_KIND_LABELS[draft.kind], locale)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {(Object.keys(PROVIDER_KIND_LABELS) as ProviderKind[]).map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {t(PROVIDER_KIND_LABELS[kind], locale)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
        {openAi && (
          <div className="grid gap-1.5 text-xs text-muted-foreground">
            <label htmlFor={uid + "-endpoint"}>Base URL</label>
            <Input
              id={uid + "-endpoint"}
              value={draft.baseUrl}
              placeholder={
                draft.kind === "openai-responses"
                  ? "https://api.openai.com/v1"
                  : "http://localhost:11434/v1"
              }
              onChange={(event) => changeConnection({ baseUrl: event.target.value })}
            />
            {draft.kind === "openai-compatible" && (
              <LocalProviderPresets onSelect={(baseUrl) => changeConnection({ baseUrl })} />
            )}
          </div>
        )}
        {draft.kind !== "faux" && (
          <label className="grid gap-1.5 text-xs text-muted-foreground">
            {isLocalOpenAiProvider(draft) && !draft.hasKey
              ? t("API Key（本地可选）", locale)
              : t("API Key {0}", locale, [draft.hasKey ? t("（留空保持不变）", locale) : ""])}
            <Input
              aria-label="API Key"
              type="password"
              value={draft.apiKeyInput}
              placeholder={draft.hasKey ? "••••••••" : ""}
              onChange={(event) => changeConnection({ apiKeyInput: event.target.value })}
            />
          </label>
        )}
      </div>
      <div className="grid gap-3 border-t border-border/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("模型列表", locale)}</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={openAi && !draft.baseUrl.trim()}
            onClick={() => void showCatalog()}
          >
            <DownloadIcon data-icon="inline-start" />
            {t(openAi ? "读取模型列表" : "浏览模型", locale)}
          </Button>
        </div>
        {draft.models.length > 0 ? (
          <div className="max-h-56 [scrollbar-width:thin] overflow-y-auto overscroll-contain rounded-xl border p-1">
            {draft.models.map((model) => {
              const chosen = model.id === draft.modelId;
              return (
                <div
                  className={cn(
                    "flex min-w-0 items-start gap-1 rounded-lg",
                    chosen && "bg-accent/65",
                  )}
                  key={model.id}
                >
                  <button
                    type="button"
                    aria-pressed={chosen}
                    title={model.id}
                    onClick={() => changeConnection({ modelId: model.id })}
                    className="flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-accent/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm">{model.name}</span>
                      {model.name !== model.id && (
                        <span className="truncate text-xs text-muted-foreground">{model.id}</span>
                      )}
                    </span>
                    {chosen && <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="mt-0.5 text-muted-foreground hover:text-destructive"
                    aria-label={t("移除模型 {0}", locale, [model.id])}
                    onClick={() => replaceModels(draft.models.filter(({ id }) => id !== model.id))}
                  >
                    <XIcon />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("可读取模型目录，或手动添加模型 ID。", locale)}
          </p>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <Input
            aria-label={t("模型 ID", locale)}
            placeholder={t("模型 ID", locale)}
            value={modelInput}
            onChange={(event) => setModelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addManualModel();
              }
            }}
          />
          <Button variant="outline" size="sm" disabled={!canAdd} onClick={addManualModel}>
            <PlusIcon data-icon="inline-start" /> {t("添加模型", locale)}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!draft.modelId || test === "loading"}
            onClick={() => void testConnection()}
          >
            {t(test === "loading" ? "测试中…" : "测试连接", locale)}
          </Button>
          {test && test !== "loading" && (
            <output
              className={cn(
                "text-xs wrap-anywhere",
                test.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {test.ok
                ? t("连接正常 · {0}ms", locale, [test.latencyMs])
                : t("连接失败：{0}", locale, [localizeError(test.error ?? "未知错误", locale)])}
            </output>
          )}
        </div>
      </div>
      {catalog && (
        <ModelCatalogDialog
          catalog={catalog}
          savedModels={draft.models}
          onClose={() => setCatalog(null)}
          onAdd={(models) => {
            replaceModels([...draft.models, ...models]);
            setCatalog(null);
          }}
        />
      )}
    </section>
  );
}
