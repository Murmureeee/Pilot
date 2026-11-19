// @env browser
// 首次启动引导向导（FR-5.7）：三步 provider → 连接 → 模型。
// 未保存草稿也支持目录浏览/连通性测试（settingsModelCatalog/testProvider 接受 ProviderInput）。
// 完成 = 把草稿追加进 providers 并激活（保留已有 provider）。
import { useState, type JSX } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { localizeError, t } from "@renderer/lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";
import { APP_NAME } from "@shared/constants";
import type {
  ModelCatalogEntry,
  ProviderInput,
  ProviderKind,
  ProviderTestResult,
} from "@shared/contract";
import { isLocalOpenAiProvider } from "@shared/providers";
import { LocalProviderPresets } from "./local-provider-presets";

const KIND_OPTIONS: { kind: ProviderKind; label: string; desc: string }[] = [
  { kind: "anthropic", label: "Anthropic", desc: "Claude 系列模型，填 API Key 即可" },
  {
    kind: "openai-compatible",
    label: "OpenAI 兼容端点",
    desc: "Ollama / LM Studio / 中转站，填 Base URL + Key",
  },
  { kind: "faux", label: "本地演示（无需 Key）", desc: "内置演示模型，离线体验完整对话与工具流" },
];

const STEPS = ["选择类型", "连接信息", "选择模型"];

export function OnboardingDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const saveSettings = useAgentStore((s) => s.saveSettings);
  const settings = useAgentStore((s) => s.settings);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<ProviderKind>("faux");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState("");
  const [testResult, setTestResult] = useState<ProviderTestResult | "loading" | null>(null);
  const [catalog, setCatalog] = useState<{
    loading: boolean;
    error?: string;
    entries: ModelCatalogEntry[];
  }>({ loading: false, entries: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setStep(1);
    setKind("faux");
    setBaseUrl("");
    setApiKey("");
    setModelId("");
    setTestResult(null);
    setCatalog({ loading: false, entries: [] });
    setError(null);
  };

  const draft = (): ProviderInput => ({
    id: `onboarding-${Date.now()}`,
    kind,
    name: t(KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? "Provider", locale),
    baseUrl: kind === "openai-compatible" ? baseUrl.trim() : undefined,
    modelId: modelId.trim() || (kind === "faux" ? "faux-default" : ""),
    apiKey: apiKey.trim().length > 0 ? apiKey.trim() : undefined,
  });

  const runTest = async (): Promise<void> => {
    setTestResult("loading");
    try {
      setTestResult(await window.pi.testProvider(draft()));
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: 0,
      });
    }
  };

  const openCatalog = async (): Promise<void> => {
    setCatalog({ loading: true, entries: [] });
    try {
      const entries = await window.pi.modelCatalog(draft());
      setCatalog({ loading: false, entries });
    } catch (err: unknown) {
      setCatalog({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        entries: [],
      });
    }
  };

  const finish = (): void => {
    setSaving(true);
    setError(null);
    const d = draft();
    // 已有 provider 原样保留（key 由主进程保留），追加草稿并激活
    const existing: ProviderInput[] = (settings?.providers ?? []).map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      modelId: p.modelId,
    }));
    void saveSettings({
      providers: [...existing, d],
      activeProviderId: d.id,
    })
      .then(() => {
        setSaving(false);
        reset();
        onClose();
      })
      .catch((err: unknown) => {
        setSaving(false);
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  const localProvider = isLocalOpenAiProvider({ kind, baseUrl });
  const canNext =
    step === 1 ||
    (step === 2 &&
      (kind === "faux" ||
        (kind === "anthropic" && apiKey.trim().length > 0) ||
        (kind === "openai-compatible" &&
          baseUrl.trim().length > 0 &&
          (localProvider || apiKey.trim().length > 0)))) ||
    (step === 3 && (kind === "faux" || modelId.trim().length > 0));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent closeLabel={t("关闭", locale)} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("开始配置 {0}", locale, [APP_NAME])}</DialogTitle>
          <DialogDescription>
            {t("第 {0}/3 步 · {1}——配置一个模型提供方即可开始对话", locale, [
              step,
              t(STEPS[step - 1], locale),
            ])}
          </DialogDescription>
        </DialogHeader>

        {/* 步骤指示器：完成步打 ✓ */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
                  step > i + 1 && "border-emerald-500 text-emerald-600 dark:text-emerald-400",
                  step === i + 1 && "border-foreground text-foreground",
                )}
              >
                {step > i + 1 ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  step === i + 1 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(label, locale)}
              </span>
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="grid gap-2">
            {KIND_OPTIONS.map((o) => (
              <button
                key={o.kind}
                type="button"
                onClick={() => {
                  setKind(o.kind);
                  setModelId(o.kind === "faux" ? "faux-default" : "");
                }}
                className={cn(
                  "border-border/70 hover:bg-accent flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  kind === o.kind && "bg-accent",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{t(o.label, locale)}</p>
                  <p className="text-muted-foreground text-xs">{t(o.desc, locale)}</p>
                </div>
                {kind === o.kind && <CheckIcon className="text-foreground size-4 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            {kind === "faux" ? (
              <p className="text-muted-foreground text-sm">
                {t(
                  "演示模型无需任何配置。发送「演示」可体验工具调用，发送「计划演示」可查看任务计划。",
                  locale,
                )}
              </p>
            ) : (
              <>
                {kind === "openai-compatible" && (
                  <div className="text-muted-foreground grid gap-1 text-xs">
                    <span>Base URL</span>
                    <Input
                      aria-label="Base URL"
                      value={baseUrl}
                      placeholder="http://localhost:11434/v1"
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                    <LocalProviderPresets onSelect={setBaseUrl} />
                  </div>
                )}
                <div className="text-muted-foreground grid gap-1 text-xs">
                  <span>{localProvider ? t("API Key（本地可选）", locale) : "API Key"}</span>
                  <Input
                    type="password"
                    value={apiKey}
                    placeholder="sk-…"
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3">
            {kind === "faux" ? (
              <p className="text-muted-foreground text-sm">faux-default</p>
            ) : (
              <>
                <div className="text-muted-foreground grid gap-1 text-xs">
                  <span className="flex items-center gap-2">
                    {t("模型 ID", locale)}
                    <button
                      type="button"
                      onClick={() => void openCatalog()}
                      className="text-foreground hover:bg-accent rounded-md px-1.5 py-0.5 font-normal transition-colors"
                    >
                      {t("浏览模型目录", locale)}
                    </button>
                  </span>
                  <Input
                    value={modelId}
                    placeholder={kind === "anthropic" ? "claude-sonnet-4-6" : "qwen3:32b"}
                    onChange={(e) => setModelId(e.target.value)}
                  />
                </div>
                {catalog.loading && (
                  <p className="text-muted-foreground text-xs">{t("加载中…", locale)}</p>
                )}
                {catalog.error && (
                  <p className="rounded-md bg-destructive/10 px-2 py-1.5 font-mono text-xs text-destructive">
                    {localizeError(catalog.error, locale)}
                  </p>
                )}
                {catalog.entries.length > 0 && (
                  <div className="border-border/70 max-h-48 overflow-y-auto rounded-xl border">
                    {catalog.entries.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModelId(m.id)}
                        className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
                      >
                        <span className="min-w-0 flex-1 truncate">{m.id}</span>
                        {modelId === m.id && (
                          <CheckIcon className="text-foreground size-3.5 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!modelId.trim() || testResult === "loading"}
                    onClick={() => void runTest()}
                  >
                    {testResult === "loading" ? t("加载中…", locale) : t("测试连接", locale)}
                  </Button>
                  {testResult && testResult !== "loading" && (
                    <span
                      className={cn(
                        "text-xs",
                        testResult.ok
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive",
                      )}
                    >
                      {testResult.ok
                        ? t("连接正常 · {0}ms", locale, [testResult.latencyMs])
                        : t("连接失败：{0}", locale, [
                            localizeError(testResult.error ?? "未知错误", locale),
                          ])}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {localizeError(error, locale)}
          </p>
        )}

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
          >
            <ArrowLeftIcon /> {t("上一步", locale)}
          </Button>
          {step < 3 ? (
            <Button size="sm" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              {t("下一步", locale)} <ArrowRightIcon />
            </Button>
          ) : (
            <Button size="sm" disabled={!canNext || saving} onClick={finish}>
              {saving ? (
                <>
                  <LoaderCircleIcon className="animate-spin" /> {t("保存中…", locale)}
                </>
              ) : (
                <>
                  <CheckIcon /> {t("完成配置", locale)}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
