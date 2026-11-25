// @env browser
import { cn } from "cn";
import {
  AlertTriangleIcon,
  CornerDownLeftIcon,
  EllipsisIcon,
  FilePenLineIcon,
  GlobeIcon,
  PlugIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import {
  COMMAND_DANGER_DESCRIPTIONS,
  COMMAND_SHELL_LABELS,
  COMPOSER_SURFACE_CLASS,
  PERMISSION_ATTENTION_TEXT,
  PERMISSION_FILE_OPERATIONS,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { describeToolScope } from "@renderer/lib/tool-rules";
import { useAgentStore } from "@renderer/stores/agent";
import type { PermissionDecision, PermissionRequest, RunRef } from "@shared/contract";

import { PermissionPreview } from "./permission-preview";

export function PermissionCard({
  request,
  run,
}: {
  request: PermissionRequest;
  run: RunRef;
}): JSX.Element {
  const locale = useLocale();
  const respondPermission = useAgentStore((s) => s.respondPermission);
  const abort = useAgentStore((s) => s.abort);
  const pendingCount = useAgentStore((s) => s.pendingPermissions.length);
  const card = useRef<HTMLElement>(null);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const shell = request.toolName === "bash";
  const file = request.toolName === "write_file" || request.toolName === "edit_file";
  const Icon = request.danger
    ? AlertTriangleIcon
    : shell
      ? TerminalIcon
      : file
        ? FilePenLineIcon
        : request.web
          ? GlobeIcon
          : PlugIcon;
  const index = request.position?.index ?? 1;
  const total = Math.max(request.position?.total ?? 1, index + pendingCount - 1);
  const scope = request.rule && describeToolScope(request.rule, locale);
  const dangerReason = request.commandDanger
    ? COMMAND_DANGER_DESCRIPTIONS[request.commandDanger]
    : "检测到可能造成破坏的操作";

  useEffect(() => {
    // 输入框随审批卡出现被隐藏，但浏览器要到下一帧才把它的焦点还给 body；
    // 只看 body 会漏掉「发送后停在输入框里」这条最常见的路径，Enter / Esc 就失效了。
    const active = document.activeElement;
    if (!active || active === document.body || active.getClientRects().length === 0)
      card.current?.focus({ preventScroll: true });
  }, []);

  const respond = async (decision: PermissionDecision): Promise<void> => {
    if (responding) return;
    setResponding(true);
    setError(null);
    try {
      await respondPermission(run, request.requestId, decision);
    } catch (cause) {
      setError(cause instanceof Error ? localizeError(cause.message, locale) : String(cause));
    } finally {
      setResponding(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (
      responding ||
      event.defaultPrevented ||
      event.nativeEvent.isComposing ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      void respond("deny");
    } else if (event.key === "Enter" && event.target === event.currentTarget) {
      event.preventDefault();
      void respond("once");
    }
  };

  return (
    <section
      ref={card}
      aria-labelledby={titleId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-permission-card
      className={cn(
        COMPOSER_SURFACE_CLASS,
        "flex max-h-[calc(100dvh-6.5rem)] min-w-0 flex-col gap-3 overflow-hidden border px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain">
        <div className="flex min-w-0 shrink-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              request.danger
                ? "bg-destructive/10 text-destructive"
                : "bg-amber-500/10 " + PERMISSION_ATTENTION_TEXT,
            )}
          >
            <Icon className="size-4" />
          </span>
          <div role="alert" className="min-w-0 flex-1 self-center">
            <h2
              id={titleId}
              className={cn(
                "text-sm font-medium wrap-anywhere",
                request.danger ? "text-destructive" : PERMISSION_ATTENTION_TEXT,
              )}
            >
              {shell
                ? t(request.commandDanger ? "允许运行危险命令？" : "允许运行此命令？", locale)
                : t("允许「{0}」？", locale, [
                    request.file
                      ? t(PERMISSION_FILE_OPERATIONS[request.file.operation], locale)
                      : (request.mcp?.tool ?? t(request.label, locale)),
                  ])}
            </h2>
            {request.workingDirectory && (
              <p className="text-xs wrap-anywhere text-muted-foreground">
                {t("工作目录", locale)} <bdi className="font-mono">{request.workingDirectory}</bdi>
              </p>
            )}
            {request.file && (
              <p className="text-xs wrap-anywhere text-muted-foreground">
                {t("目标文件", locale)} <bdi className="font-mono">{request.file.path}</bdi>
              </p>
            )}
            {request.mcp && (
              <p className="text-xs wrap-anywhere text-muted-foreground" data-permission-mcp-server>
                {t("MCP 服务 {0}", locale, [request.mcp.server])}
              </p>
            )}
            {request.web && (
              <p className="text-xs wrap-anywhere text-muted-foreground">
                {t("目标域名", locale)}{" "}
                <bdi className="font-mono" data-permission-domain>
                  {request.web.domain}
                </bdi>
              </p>
            )}
            {request.commandShell && (
              <p className="text-xs text-muted-foreground">
                {t("命令环境", locale)}{" "}
                {request.commandShell === "bash" && !navigator.userAgent.includes("Windows")
                  ? "Bash"
                  : COMMAND_SHELL_LABELS[request.commandShell]}
              </p>
            )}
            {request.danger && (
              <p className="text-xs text-muted-foreground">{t(dangerReason, locale)}</p>
            )}
          </div>
          {total > 1 && (
            <span
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
              data-permission-position
            >
              <span aria-hidden="true">
                {index} / {total}
              </span>
              <span className="sr-only">
                {t("第 {0} 项审批，共 {1} 项", locale, [index, total])}
              </span>
            </span>
          )}
        </div>

        <PermissionPreview request={request} />

        {shell && !scope && !request.danger && (
          <p className="text-xs text-muted-foreground">{t("此命令需要逐次审批。", locale)}</p>
        )}

        {error && (
          <p role="alert" className="text-xs wrap-anywhere text-destructive">
            {t("审批提交失败，请重试。", locale)} {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="me-auto flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => abort(run)}>
            <SquareIcon data-icon="inline-start" />
            {t("停止", locale)}
          </Button>
          {scope && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button type="button" variant="ghost" size="icon-sm" />}
                disabled={responding}
                aria-label={t("更多授权选项", locale)}
                title={t("更多授权选项", locale)}
              >
                <EllipsisIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="max-w-[min(25rem,calc(100vw-1.5rem))]"
              >
                <DropdownMenuGroup>
                  {(
                    [
                      ["session", "本会话始终允许"],
                      ["global", "总是允许"],
                    ] as const
                  ).map(([decision, title]) => (
                    <DropdownMenuItem
                      key={decision}
                      className="items-start"
                      onClick={() => void respond(decision)}
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="whitespace-nowrap">{t(title, locale)}</span>
                        <span className="text-xs wrap-anywhere text-muted-foreground">{scope}</span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={responding}
            aria-keyshortcuts="Escape"
            onClick={() => void respond("deny")}
          >
            {t("拒绝", locale)}
            <kbd
              aria-hidden="true"
              className="rounded bg-muted px-1 font-sans text-[10px] leading-4"
            >
              Esc
            </kbd>
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={responding}
            aria-keyshortcuts="Enter"
            onClick={() => void respond("once")}
          >
            {t("本次允许", locale)}
            <CornerDownLeftIcon aria-hidden="true" className="size-3.5 opacity-70" />
          </Button>
        </div>
      </div>
    </section>
  );
}
