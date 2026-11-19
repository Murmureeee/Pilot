// @env browser
import { useState, type KeyboardEvent } from "react";
import type { JSX } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  EyeIcon,
  ShieldCheckIcon,
  SquareIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@renderer/components/ui/input-group";
import { levelAt, levelIndex, levelLabel, THINKING_LEVELS } from "@renderer/lib/thinking-level";
import { APPROVAL_MODE_OPTIONS } from "@renderer/lib/constants";
import { displayProviderName, t } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { APP_NAME } from "@shared/constants";
import type { ApprovalMode } from "@shared/contract";
import { cn } from "cn";

// 语义色分级（AGENTS.md）：红 = 破坏性动作；amber 橙 = 风险提示（警觉但不吓退）；灰 = 常态
type ModeTone = "neutral" | "amber";

const MODE_META: Record<
  ApprovalMode,
  { label: string; description: string; icon: typeof ShieldCheckIcon; tone: ModeTone }
> = {
  standard: {
    ...APPROVAL_MODE_OPTIONS.standard,
    icon: ShieldCheckIcon,
    tone: "neutral",
  },
  "read-only": {
    ...APPROVAL_MODE_OPTIONS["read-only"],
    icon: EyeIcon,
    tone: "neutral",
  },
  "full-access": {
    ...APPROVAL_MODE_OPTIONS["full-access"],
    icon: ZapIcon,
    tone: "amber",
  },
};

const TONE_TEXT: Record<ModeTone, string> = {
  neutral: "",
  amber: "text-amber-600 dark:text-amber-400",
};

const TONE_BADGE: Record<ModeTone, string> = {
  neutral: "bg-muted text-foreground hover:bg-accent",
  amber: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400",
};

export function Composer(): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const status = useAgentStore((s) => s.status);
  const busy = status !== "idle";
  const settings = useAgentStore((s) => s.settings);
  const steerCount = useAgentStore((s) => s.steerCount);
  const usage = useAgentStore((s) => s.usage);
  const contextTokens = useAgentStore((s) => s.contextTokens);
  const contextWindow = useAgentStore((s) => s.contextWindow);
  const [text, setText] = useState("");
  const prompt = useAgentStore((s) => s.prompt);
  const abort = useAgentStore((s) => s.abort);
  const clearQueue = useAgentStore((s) => s.clearQueue);
  const setApprovalMode = useAgentStore((s) => s.setApprovalMode);
  const switchModel = useAgentStore((s) => s.switchModel);
  const setThinkingLevel = useAgentStore((s) => s.setThinkingLevel);

  const mode = settings?.approvalMode ?? "standard";
  const modeMeta = MODE_META[mode];
  const ModeIcon = modeMeta.icon;
  const active = settings?.providers.find((p) => p.id === settings.activeProviderId);
  const thinkingLevel = settings?.thinkingLevel ?? "medium";

  const send = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    void prompt(trimmed);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const statusLabel =
    status === "waiting_approval" ? t("等待操作审批…", locale) : t("回复中…", locale);
  const contextPercent =
    contextWindow && contextWindow > 0 && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
      : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      {busy && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <output
              className={cn(
                "flex items-center gap-2",
                status === "waiting_approval"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {statusLabel}
            </output>
            {steerCount > 0 && (
              <>
                <span>{t("插话排队 {0}", locale, [steerCount])}</span>
                <button
                  type="button"
                  onClick={clearQueue}
                  className="hover:text-foreground underline underline-offset-2"
                >
                  {t("清空排队", locale)}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              {usage.input + usage.output} tokens
              {usage.cacheRead > 0 ? ` (${t("缓存", locale)} ${usage.cacheRead})` : ""}
            </span>
            <span>${usage.costTotal.toFixed(4)}</span>
            {contextPercent !== null && (
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  contextPercent > 80 && "text-amber-700 dark:text-amber-400",
                )}
              >
                {t("上下文", locale)} {contextPercent}%
                <span
                  aria-hidden="true"
                  className="bg-border h-1 w-12 overflow-hidden rounded-full"
                >
                  <span
                    className="block h-full rounded-full bg-current"
                    style={{ width: `${contextPercent}%` }}
                  />
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      <InputGroup className="border-border bg-card rounded-[22px] shadow-sm shadow-foreground/10">
        <InputGroupTextarea
          className="min-h-[3.75rem] max-h-[min(14rem,38vh)] px-4 pt-3.5 pb-2 text-[15px] leading-6 md:text-[15px]"
          aria-label={t("消息", locale)}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? t("输入插话消息…", locale) : t("给 {0} 发消息…", locale, [APP_NAME])}
          rows={2}
        />
        <InputGroupAddon
          align="block-end"
          className="cursor-default items-center justify-between gap-2 p-2 pt-0"
        >
          <div className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "focus-visible:ring-ring/40 flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
                      TONE_BADGE[modeMeta.tone],
                    )}
                  />
                }
              >
                <ModeIcon className="size-3.5" />
                {t(modeMeta.label, locale)}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="min-w-64 max-w-[min(24rem,var(--available-width))]"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-foreground font-medium">
                    {t("应如何批准 Agent 操作？", locale)}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(Object.keys(MODE_META) as ApprovalMode[]).map((m) => {
                    const meta = MODE_META[m];
                    const Icon = meta.icon;
                    const current = mode === m;
                    return (
                      // 规范（AGENTS.md）：主标题 + 上下结构的次级说明行（muted + 小字号）；选中态用右侧 ✓；
                      // 图标带语义色时，标题文字跟随同色（主次一体）
                      <DropdownMenuItem
                        key={m}
                        onClick={() => void setApprovalMode(m)}
                        className="items-start gap-2.5 py-2"
                      >
                        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[meta.tone])} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={cn("text-sm leading-5", TONE_TEXT[meta.tone])}>
                            {t(meta.label, locale)}
                          </span>
                          <span className="text-muted-foreground text-xs leading-4">
                            {t(meta.description, locale)}
                          </span>
                        </div>
                        {current && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="ms-auto flex min-w-0 items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("选择模型", locale)}
                    title={active?.modelId}
                    className="border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 flex min-h-8 min-w-0 max-w-56 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2"
                  />
                }
              >
                <CpuIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{active ? active.modelId : t("选择模型", locale)}</span>
                <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="min-w-64 max-w-[min(26rem,var(--available-width))]"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t("模型（点击切换）", locale)}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(settings?.providers ?? []).map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => void switchModel(p.id)}
                      className="items-start gap-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm">{displayProviderName(p, locale)}</span>
                        <span className="text-muted-foreground wrap-anywhere text-xs">
                          {p.modelId}
                        </span>
                      </span>
                      {p.id === settings?.activeProviderId && (
                        <CheckIcon className="mt-0.5 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  {(settings?.providers ?? []).length === 0 && (
                    <DropdownMenuItem disabled>{t("尚未配置 Provider", locale)}</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* 思考强度滑块：非 MenuItem，交互不关闭菜单 */}
                <div className="px-2 py-2">
                  <div className="flex items-center justify-between pb-2 text-xs">
                    <span className="text-muted-foreground">{t("思考强度", locale)}</span>
                    <span className="text-foreground">{t(levelLabel(thinkingLevel), locale)}</span>
                  </div>
                  <input
                    type="range"
                    aria-label={t("思考强度", locale)}
                    aria-valuetext={t(levelLabel(thinkingLevel), locale)}
                    min={0}
                    max={THINKING_LEVELS.length - 1}
                    step={1}
                    value={levelIndex(thinkingLevel)}
                    onChange={(e) => void setThinkingLevel(levelAt(Number(e.target.value)))}
                    className="level-slider w-full"
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {busy ? (
              <Button
                size="icon-lg"
                className="rounded-full"
                onClick={abort}
                aria-label={t("停止", locale)}
                title={t("停止", locale)}
              >
                <SquareIcon className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-lg"
                className="disabled:bg-muted disabled:text-muted-foreground rounded-full disabled:opacity-100"
                disabled={text.trim().length === 0}
                onClick={send}
                aria-label={t("发送", locale)}
                title={t("发送", locale)}
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
