// @env browser
import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";
import {
  AlertTriangleIcon,
  CornerDownLeftIcon,
  EllipsisIcon,
  FilePenLineIcon,
  PlugIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { COMPOSER_SURFACE_CLASS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { toolInput } from "@renderer/lib/tool-trace";
import { useAgentStore } from "@renderer/stores/agent";
import type { PermissionDecision, PermissionRequest, RunRef } from "@shared/contract";
import { cn } from "cn";

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
  const remaining = useAgentStore((s) => s.pendingPermissions.length - 1);
  const card = useRef<HTMLElement>(null);
  const code = useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const detailsId = useId();
  const shell = request.toolName === "bash";
  const file = request.toolName === "write_file" || request.toolName === "edit_file";
  const Icon = request.danger
    ? AlertTriangleIcon
    : shell
      ? TerminalIcon
      : file
        ? FilePenLineIcon
        : PlugIcon;
  const input = useMemo(() => toolInput(request.inputSummary), [request.inputSummary]);
  const preview = input.preview === request.inputSummary ? input.details : input.preview;
  const hasMore = preview !== input.details;
  const text =
    expanded && hasMore && shell
      ? `${preview}\n\n${input.details}`
      : expanded
        ? input.details
        : preview;

  useEffect(() => {
    if (document.activeElement === document.body) card.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const content = code.current?.firstElementChild;
    if (!content || expanded) return;
    const measure = (): void => setClipped(content.scrollHeight > content.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [expanded]);

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
        "focus-visible:ring-ring/35 flex min-w-0 flex-col gap-3 border px-4 py-3.5 outline-none focus-visible:ring-2",
      )}
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg",
            request.danger
              ? "bg-destructive/10 text-destructive"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 self-center">
          <h2
            id={titleId}
            className={cn(
              "text-sm font-medium wrap-anywhere",
              request.danger && "text-destructive",
            )}
          >
            {shell
              ? t("允许运行此命令？", locale)
              : t("允许「{0}」？", locale, [t(request.label, locale)])}
          </h2>
          {request.danger && (
            <p className="text-muted-foreground text-xs">{t("检测到可能造成破坏的操作", locale)}</p>
          )}
        </div>
      </div>

      {preview && (
        <div className="flex min-w-0 flex-col gap-0.5">
          <CodeBlock size="sm" variant={request.danger ? "destructive" : "default"}>
            <CodeBlockContent
              ref={code}
              id={detailsId}
              wrap
              tabIndex={expanded ? 0 : -1}
              className={cn(
                "overscroll-contain",
                expanded ? "max-h-[min(36vh,14rem)]" : "overflow-hidden [&>code]:line-clamp-3",
              )}
            >
              {text}
            </CodeBlockContent>
          </CodeBlock>
          {(hasMore || clipped || expanded) && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground self-end"
              aria-expanded={expanded}
              aria-controls={detailsId}
              onClick={() => setExpanded(!expanded)}
            >
              {t(expanded ? "收起详情" : "展开详情", locale)}
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-xs wrap-anywhere">
          {t("审批提交失败，请重试。", locale)} {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="me-auto flex min-w-0 items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => abort(run)}>
            <SquareIcon data-icon="inline-start" />
            {t("停止", locale)}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" size="icon-sm" />}
              disabled={responding}
              aria-label={t("更多授权选项", locale)}
              title={t("更多授权选项", locale)}
            >
              <EllipsisIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8}>
              <DropdownMenuItem onClick={() => void respond("session")}>
                {t("本会话始终允许", locale)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void respond("global")}>
                {t("总是允许", locale)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {remaining > 0 && (
            <span className="text-muted-foreground text-xs">
              {t("另有 {0} 项待审批", locale, [remaining])}
            </span>
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
              className="bg-muted rounded px-1 font-sans text-[10px] leading-4"
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
