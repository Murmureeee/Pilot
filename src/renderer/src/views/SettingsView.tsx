// @env browser
import { useEffect, useRef, useState, type JSX } from "react";
import { CheckIcon, FolderOpenIcon, PlusIcon, SaveIcon, TrashIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { Textarea } from "@renderer/components/ui/textarea";
import { SETTINGS_SECTION_LABELS } from "@renderer/lib/constants";
import { displayProviderName, localizeError, t } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";
import type {
  AppInfo,
  ModelCatalogEntry,
  ProviderInput,
  ProviderKind,
  ProviderTestResult,
} from "@shared/contract";
import { isLocalOpenAiProvider, isOpenAiProvider } from "@shared/providers";
import { LocalProviderPresets } from "@renderer/components/ai/local-provider-presets";
import { McpSettings } from "@renderer/components/ai/mcp-settings";
import { ExternalImportSettings } from "@renderer/components/ai/external-import-settings";
import { DataSettings } from "@renderer/views/settings/DataSettings";
import { GeneralSettings } from "@renderer/views/settings/GeneralSettings";

interface DraftProvider {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  modelId: string;
  hasKey: boolean;
  apiKeyInput: string;
}

const KIND_LABELS: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  faux: "Faux 测试（无需 key）",
};

function toProviderInput(draft: DraftProvider): ProviderInput {
  return {
    id: draft.id,
    kind: draft.kind,
    name: draft.name || draft.id,
    baseUrl: isOpenAiProvider(draft.kind) ? draft.baseUrl : undefined,
    modelId: draft.modelId,
    apiKey: draft.apiKeyInput || undefined,
  };
}

/** 连通性测试结果行：emerald 成功（含延迟）/ 红 失败（含错误信息）；loading 与未测过 = 不渲染 */
function TestResultLine({
  result,
}: {
  result: ProviderTestResult | "loading" | undefined;
}): JSX.Element | null {
  const locale = useAgentStore((s) => s.locale);
  if (!result || result === "loading") return null;
  return (
    <span
      className={cn(
        "text-xs",
        result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
      )}
    >
      {result.ok
        ? t("连接正常 · {0}ms", locale, [result.latencyMs])
        : t("连接失败：{0}", locale, [localizeError(result.error ?? "未知错误", locale)])}
    </span>
  );
}

function PersonalizationSettings({
  savedInstructions,
}: {
  savedInstructions: string;
}): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const savePersona = useAgentStore((s) => s.savePersona);
  const [draft, setDraft] = useState(savedInstructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChanges = draft !== savedInstructions;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await savePersona(draft.trim());
      setDraft(draft.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div>
        <label htmlFor="custom-instructions" className="text-sm font-medium">
          {t("自定义指令", locale)}
        </label>
        <p id="custom-instructions-help" className="text-muted-foreground mt-0.5 text-xs leading-5">
          {t("默认用于所有会话。可通过会话菜单为单个聊天设置指令。", locale)}
        </p>
      </div>
      <Textarea
        id="custom-instructions"
        aria-describedby="custom-instructions-help"
        className="bg-card min-h-40 rounded-2xl px-4 py-3 leading-6"
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        rows={8}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={saving || !hasChanges}
          onClick={() => {
            setDraft(savedInstructions);
            setError(null);
          }}
        >
          {t("撤销修改", locale)}
        </Button>
        <Button size="sm" disabled={saving || !hasChanges} onClick={() => void save()}>
          {t(saving ? "保存中…" : "保存", locale)}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {localizeError(error, locale)}
        </p>
      )}
    </div>
  );
}

export function SettingsView(): JSX.Element {
  const settings = useAgentStore((s) => s.settings);
  const skills = useAgentStore((s) => s.skills);
  const saveSettings = useAgentStore((s) => s.saveSettings);
  const listSkills = useAgentStore((s) => s.listSkills);
  const importSkills = useAgentStore((s) => s.importSkills);
  const toggleSkill = useAgentStore((s) => s.toggleSkill);
  const locale = useAgentStore((s) => s.locale);
  const section = useAgentStore((s) => s.settingsSection);
  const scroller = useRef<HTMLDivElement>(null);
  const previousSection = useRef(section);
  const [drafts, setDrafts] = useState<DraftProvider[]>(() =>
    (settings?.providers ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl ?? "",
      modelId: p.modelId,
      hasKey: p.hasKey,
      apiKeyInput: "",
    })),
  );
  const [activeId, setActiveId] = useState(settings?.activeProviderId ?? "");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void window.pi.getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    if (section === "skills") void listSkills();
  }, [listSkills, section]);

  useEffect(() => {
    if (previousSection.current !== section) scroller.current?.scrollTo(0, 0);
    previousSection.current = section;
  }, [section]);

  const update = (id: string, patch: Partial<DraftProvider>): void => {
    setDrafts((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const addProvider = (): void => {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `p-${Date.now()}`;
    setDrafts((list) => [
      ...list,
      {
        id,
        kind: "openai-compatible",
        name: t("新提供方", locale),
        baseUrl: "",
        modelId: "",
        hasKey: false,
        apiKeyInput: "",
      },
    ]);
    if (!activeId) setActiveId(id);
  };

  const removeProvider = (id: string): void => {
    setDrafts((list) => list.filter((d) => d.id !== id));
    if (activeId === id) setActiveId("");
  };

  const save = (): void => {
    setSaving(true);
    setSaveError(null);
    const providers = drafts.map(toProviderInput);
    const first = providers.find((p) => p.id === activeId) ?? providers[0];
    void saveSettings({
      providers,
      activeProviderId: first ? first.id : "",
    })
      .catch((err: unknown) => setSaveError(err instanceof Error ? err.message : String(err)))
      .finally(() => setSaving(false));
  };

  // FR-5.1 连通性测试：结果按 providerId 存放（"loading" = 进行中）
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult | "loading">>(
    {},
  );
  // FR-5.2 模型目录浏览弹窗：catalogTarget = 正在浏览的 provider id
  const [catalogTarget, setCatalogTarget] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<{
    loading: boolean;
    error?: string;
    entries: ModelCatalogEntry[];
  }>({ loading: false, entries: [] });

  const runTest = async (draft: DraftProvider): Promise<void> => {
    const { id } = draft;
    setTestResults((r) => ({ ...r, [id]: "loading" }));
    try {
      const result = await window.pi.testProvider(toProviderInput(draft));
      setTestResults((r) => ({ ...r, [id]: result }));
    } catch (err: unknown) {
      setTestResults((r) => ({
        ...r,
        [id]: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          latencyMs: 0,
        },
      }));
    }
  };

  const openCatalog = async (draft: DraftProvider): Promise<void> => {
    setCatalogTarget(draft.id);
    setCatalog({ loading: true, entries: [] });
    try {
      const entries = await window.pi.modelCatalog(toProviderInput(draft));
      setCatalog({ loading: false, entries });
    } catch (err: unknown) {
      setCatalog({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        entries: [],
      });
    }
  };

  return (
    <div
      ref={scroller}
      className="settings-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
    >
      <div className="workspace-column grid gap-7 pt-7 pb-10 sm:pt-9">
        <h1 className="text-[clamp(1.375rem,2.5vw,1.75rem)] leading-tight font-semibold tracking-tight">
          {t(SETTINGS_SECTION_LABELS[section], locale)}
        </h1>

        {/* Keep in-progress edits when the settings page changes. */}
        <div hidden={section !== "general"}>
          {settings && (
            <GeneralSettings settings={settings} isWindows={appInfo?.isWindows ?? false} />
          )}
        </div>

        <div hidden={section !== "providers"}>
          <div className="flex flex-col gap-4">
            {drafts.map((d) => (
              <div key={d.id} className="bg-card overflow-hidden rounded-2xl border">
                <div className="bg-muted/70 flex items-center justify-between gap-3 border-b px-4 py-3">
                  <label
                    htmlFor={`active-provider-${d.id}`}
                    className="flex min-w-0 items-center gap-3 text-sm"
                  >
                    <Switch
                      id={`active-provider-${d.id}`}
                      checked={activeId === d.id}
                      onCheckedChange={(checked) => {
                        if (checked) setActiveId(d.id);
                      }}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {displayProviderName(d, locale) || d.id}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {d.hasKey
                          ? t("key 已配置", locale)
                          : d.kind === "faux" || isLocalOpenAiProvider(d)
                            ? t("无需 key", locale)
                            : t("未配置 key", locale)}
                      </span>
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("删除提供方", locale)}
                    onClick={() => removeProvider(d.id)}
                  >
                    <TrashIcon />
                  </Button>
                </div>

                <div className="grid gap-4 p-4">
                  <div className="settings-fields">
                    <div className="text-muted-foreground grid gap-1 text-xs">
                      <span>{t("名称", locale)}</span>
                      <Input
                        aria-label={t("名称", locale)}
                        value={d.name}
                        onChange={(e) => update(d.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="text-muted-foreground grid gap-1 text-xs">
                      <span>{t("类型", locale)}</span>
                      <Select
                        value={d.kind}
                        onValueChange={(v: ProviderKind | null) => {
                          if (v) update(d.id, { kind: v });
                        }}
                      >
                        <SelectTrigger aria-label={t("类型", locale)} className="w-full min-w-0">
                          <SelectValue>{t(KIND_LABELS[d.kind], locale)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(Object.keys(KIND_LABELS) as ProviderKind[]).map((k) => (
                              <SelectItem key={k} value={k}>
                                {t(KIND_LABELS[k], locale)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {isOpenAiProvider(d.kind) && (
                    <div className="text-muted-foreground grid gap-1 text-xs">
                      <span>Base URL</span>
                      <Input
                        aria-label="Base URL"
                        value={d.baseUrl}
                        placeholder={
                          d.kind === "openai-responses"
                            ? "https://api.openai.com/v1"
                            : "http://localhost:11434/v1"
                        }
                        onChange={(e) => update(d.id, { baseUrl: e.target.value })}
                      />
                      {d.kind === "openai-compatible" && (
                        <LocalProviderPresets onSelect={(baseUrl) => update(d.id, { baseUrl })} />
                      )}
                    </div>
                  )}

                  <div className="settings-fields">
                    <div className="text-muted-foreground grid gap-1 text-xs">
                      <span className="flex flex-wrap items-center justify-between gap-x-2">
                        {t("模型 ID", locale)}
                        <button
                          type="button"
                          onClick={() => void openCatalog(d)}
                          className="text-foreground hover:bg-accent rounded-md px-1.5 py-0.5 font-normal transition-colors"
                        >
                          {t("浏览模型", locale)}
                        </button>
                      </span>
                      <Input
                        aria-label={t("模型 ID", locale)}
                        value={d.modelId}
                        placeholder={d.kind === "anthropic" ? "claude-sonnet-4-6" : "qwen3:32b"}
                        onChange={(e) => update(d.id, { modelId: e.target.value })}
                      />
                    </div>
                    {d.kind !== "faux" && (
                      <div className="text-muted-foreground grid gap-1 text-xs">
                        <span>
                          {isLocalOpenAiProvider(d) && !d.hasKey
                            ? t("API Key（本地可选）", locale)
                            : t("API Key {0}", locale, [
                                d.hasKey ? t("（留空保持不变）", locale) : "",
                              ])}
                        </span>
                        <Input
                          aria-label="API Key"
                          type="password"
                          value={d.apiKeyInput}
                          placeholder={d.hasKey ? "••••••••" : ""}
                          onChange={(e) => update(d.id, { apiKeyInput: e.target.value })}
                        />
                      </div>
                    )}
                  </div>

                  {/* 连通性测试（FR-5.1）：结果行内回显，emerald 成功 / 红 错误 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!d.modelId.trim() || testResults[d.id] === "loading"}
                      onClick={() => void runTest(d)}
                    >
                      {t("测试连接", locale)}
                    </Button>
                    <TestResultLine result={testResults[d.id]} />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={addProvider}>
                <PlusIcon /> {t("添加提供方", locale)}
              </Button>
              <Button size="sm" onClick={() => save()} disabled={saving}>
                <SaveIcon /> {saving ? t("保存中…", locale) : t("保存", locale)}
              </Button>
            </div>

            {saveError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
                {localizeError(saveError, locale)}
              </p>
            )}
          </div>
        </div>

        <div hidden={section !== "persona"}>
          {settings && <PersonalizationSettings savedInstructions={settings.persona} />}
        </div>

        <div hidden={section !== "data"}>
          <DataSettings appInfo={appInfo} />
        </div>

        {section === "skills" && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void importSkills()}>
                <PlusIcon data-icon="inline-start" /> {t("导入技能目录", locale)}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void window.pi.openPath("skills")}>
                <FolderOpenIcon data-icon="inline-start" /> {t("打开技能目录", locale)}
              </Button>
            </div>
            <div className="settings-list">
              {skills.length === 0 && (
                <p className="text-muted-foreground px-4 py-3.5 text-sm">
                  {t("还没有技能", locale)}
                </p>
              )}
              {skills.map((skill) => (
                <div key={skill.id} className="settings-row flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <p className="wrap-anywhere text-sm">{skill.name}</p>
                    {skill.description && (
                      <p
                        className="text-muted-foreground line-clamp-2 text-xs leading-5"
                        title={skill.description}
                      >
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    aria-label={skill.name}
                    checked={skill.enabled}
                    onCheckedChange={(checked) => void toggleSkill(skill.id, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "mcp" && <McpSettings locale={locale} />}

        {section === "imports" && (
          <ExternalImportSettings
            locale={locale}
            workingDirectory={settings?.workingDirectory ?? null}
          />
        )}
      </div>

      {/* 模型目录浏览（FR-5.2）：点击条目回填 modelId；当前模型右侧 ✓ */}
      <Dialog
        open={catalogTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCatalogTarget(null);
        }}
      >
        <DialogContent closeLabel={t("关闭", locale)} className="max-h-[70vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("模型目录", locale)}</DialogTitle>
            <DialogDescription>
              {t("点击选择模型；也可以手动填写模型 ID", locale)}
            </DialogDescription>
          </DialogHeader>
          {catalog.loading && (
            <p className="text-muted-foreground text-sm">{t("加载中…", locale)}</p>
          )}
          {catalog.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {localizeError(catalog.error, locale)}
            </p>
          )}
          <div className="grid gap-1">
            {catalog.entries.map((m) => {
              const current = drafts.find((d) => d.id === catalogTarget)?.modelId === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    if (catalogTarget) update(catalogTarget, { modelId: m.id });
                    setCatalogTarget(null);
                  }}
                  className="hover:bg-accent flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{m.id}</p>
                    {m.contextWindow !== undefined && (
                      <p className="text-muted-foreground text-xs">
                        {t("上下文 {0}K", locale, [Math.round(m.contextWindow / 1000)])}
                      </p>
                    )}
                  </div>
                  {current && <CheckIcon className="text-foreground size-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
