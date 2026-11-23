// @env browser
import { useState, type JSX } from "react";
import { CheckIcon, ChevronDownIcon, PlusIcon, SaveIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { PROVIDER_KIND_LABELS } from "@renderer/lib/constants";
import { displayProviderName, localizeError, t, useLocale } from "@renderer/lib/i18n";
import { levelLabel } from "@renderer/lib/thinking-level";
import { useAgentStore } from "@renderer/stores/agent";
import { THINKING_LEVELS } from "@shared/constants";
import type { ProviderInput, PublicSettings, ThinkingLevel } from "@shared/contract";
import { isOpenAiProvider } from "@shared/providers";
import { cn } from "cn";
import { ProviderEditor } from "./ProviderEditor";
import type { DraftProvider } from "./types";

function toProviderInput(draft: DraftProvider): ProviderInput {
  return {
    id: draft.id,
    kind: draft.kind,
    name: draft.name.trim() || draft.id,
    baseUrl: isOpenAiProvider(draft.kind) ? draft.baseUrl.trim() : undefined,
    modelId: draft.modelId,
    models: draft.models,
    apiKey: draft.kind === "faux" ? undefined : draft.apiKeyInput.trim() || undefined,
  };
}

function toDrafts(settings: PublicSettings): DraftProvider[] {
  return settings.providers.map((provider) => ({
    ...provider,
    baseUrl: provider.baseUrl ?? "",
    apiKeyInput: "",
  }));
}

export function ProviderSettings({ settings }: { settings: PublicSettings }): JSX.Element {
  const locale = useLocale();
  const saveSettings = useAgentStore((state) => state.saveSettings);
  const [drafts, setDrafts] = useState<DraftProvider[]>(() => toDrafts(settings));
  const [activeId, setActiveId] = useState(settings.activeProviderId);
  const [editorId, setEditorId] = useState(settings.activeProviderId || drafts[0]?.id);
  const [levels, setLevels] = useState<ThinkingLevel[]>(settings.thinkingLevels);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editor = drafts.find(({ id }) => id === editorId);
  const dirty =
    JSON.stringify([drafts, activeId, levels]) !==
    JSON.stringify([toDrafts(settings), settings.activeProviderId, settings.thinkingLevels]);

  const add = (): void => {
    const id = crypto.randomUUID();
    setDrafts((current) => [
      ...current,
      {
        id,
        kind: "openai-compatible",
        name: t("新提供方", locale),
        baseUrl: "",
        modelId: "",
        models: [],
        hasKey: false,
        apiKeyInput: "",
      },
    ]);
    setEditorId(id);
  };

  const remove = (id: string): void => {
    const remaining = drafts.filter((draft) => draft.id !== id);
    setDrafts(remaining);
    if (activeId === id) setActiveId(remaining.find((draft) => draft.modelId)?.id ?? "");
    setEditorId(remaining[0]?.id);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const providers = drafts.map(toProviderInput);
    const active =
      providers.find((provider) => provider.id === activeId && provider.modelId) ??
      providers.find((provider) => provider.modelId);
    try {
      await saveSettings({ providers, activeProviderId: active?.id ?? "", thinkingLevels: levels });
      // 以主进程落盘后的结果为准：清空已提交的密钥输入，并同步规范化后的名称与当前提供方。
      const next = useAgentStore.getState().settings;
      if (next) {
        setDrafts(toDrafts(next));
        setActiveId(next.activeProviderId);
        setLevels(next.thinkingLevels);
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      <section className="grid gap-2.5" aria-labelledby="provider-list-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="provider-list-heading" className="text-sm font-medium">
            {t("提供方", locale)}
          </h2>
          <Button variant="outline" size="sm" onClick={add}>
            <PlusIcon data-icon="inline-start" /> {t("添加提供方", locale)}
          </Button>
        </div>
        <div className="settings-card max-h-52 overflow-y-auto [scrollbar-width:thin]">
          {drafts.length === 0 && (
            <p className="text-muted-foreground px-4 py-3.5 text-sm">
              {t("尚未配置 Provider", locale)}
            </p>
          )}
          {drafts.map((draft) => (
            <button
              type="button"
              key={draft.id}
              aria-pressed={draft.id === editorId}
              onClick={() => setEditorId(draft.id)}
              className={cn(
                "settings-row hover:bg-accent/80 focus-visible:ring-ring w-full gap-x-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset",
                draft.id === editorId && "bg-accent/65",
              )}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm">
                  {displayProviderName(draft, locale) || draft.id}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {t(PROVIDER_KIND_LABELS[draft.kind], locale)}
                </span>
              </span>
              {draft.id === activeId && (
                <span title={t("当前提供方", locale)} className="shrink-0">
                  <CheckIcon aria-hidden="true" className="size-4" />
                  <span className="sr-only">{t("当前提供方", locale)}</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
      {editor && (
        <ProviderEditor
          key={editor.id}
          draft={editor}
          active={editor.id === activeId}
          toInput={toProviderInput}
          onChange={(patch) =>
            setDrafts((list) =>
              list.map((draft) => (draft.id === editor.id ? { ...draft, ...patch } : draft)),
            )
          }
          onActivate={() => setActiveId(editor.id)}
          onRemove={() => remove(editor.id)}
        />
      )}
      <section aria-labelledby="thinking-levels-heading" className="settings-card">
        <div className="settings-row gap-x-3">
          <div className="min-w-0 flex-1 basis-48">
            <h2 id="thinking-levels-heading" className="text-sm font-medium">
              {t("可用思考强度", locale)}
            </h2>
            <p className="text-muted-foreground text-xs leading-5">
              {t("选择聊天面板显示的档位。实际生效取决于模型支持。", locale)}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
              {t("已选 {0} 档", locale, [levels.length])}
              <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setLevels([...THINKING_LEVELS])}>
                  {t("恢复默认", locale)}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {THINKING_LEVELS.map((level) => {
                  const checked = levels.includes(level);
                  return (
                    <DropdownMenuCheckboxItem
                      key={level}
                      checked={checked}
                      disabled={checked && levels.length === 1}
                      onCheckedChange={(selected) =>
                        setLevels((current) =>
                          selected ? [...current, level] : current.filter((item) => item !== level),
                        )
                      }
                      closeOnClick={false}
                    >
                      {t(levelLabel(level), locale)}
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      {error && (
        <p role="alert" className="text-destructive wrap-anywhere text-sm">
          {localizeError(error, locale)}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {saved && !dirty && (
          <output className="text-muted-foreground text-xs">{t("已保存", locale)}</output>
        )}
        <Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>
          <SaveIcon data-icon="inline-start" /> {t(saving ? "保存中…" : "保存", locale)}
        </Button>
      </div>
    </div>
  );
}
