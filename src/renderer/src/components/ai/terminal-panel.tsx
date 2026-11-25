// @env browser
import type { Terminal } from "@xterm/xterm";
import { cn } from "cn";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CopyIcon,
  LoaderCircleIcon,
  PlusIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { DEFAULT_TERMINAL_SIZE, TERMINAL_STATUS_LABELS } from "@renderer/lib/constants";
import { showFeedback, showFeedbackError } from "@renderer/lib/feedback";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { TerminalRecord } from "@shared/contract";

import { TerminalViewport, terminalText } from "./terminal-viewport";

function terminalName(record: TerminalRecord): string {
  return record.command ?? (record.shell === "powershell" ? "PowerShell" : "Bash");
}

function setRecord(
  records: TerminalRecord[],
  id: string,
  record: TerminalRecord | null,
): TerminalRecord[] {
  if (!record) return records.filter((item) => item.id !== id);
  if (records.some((item) => item.id === id))
    return records.map((item) => (item.id === id ? record : item));
  return [...records, record];
}

function TerminalStatus({ record }: { record: TerminalRecord }): JSX.Element {
  const locale = useLocale();
  const { status } = record;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 whitespace-nowrap",
        status === "running" || status === "success"
          ? "text-emerald-700 dark:text-emerald-400"
          : status === "failed"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
      data-terminal-status={status}
    >
      {(status === "running" || status === "stopping") && (
        <LoaderCircleIcon aria-hidden="true" className="size-3 motion-safe:animate-spin" />
      )}
      {status === "failed" && <CircleAlertIcon aria-hidden="true" className="size-3" />}
      {status === "success" && <CheckIcon aria-hidden="true" className="size-3" />}
      {t(TERMINAL_STATUS_LABELS[status], locale)}
    </span>
  );
}

export default function TerminalPanel({
  composerId,
  workingDirectory,
}: {
  composerId: string;
  workingDirectory: string | null;
}): JSX.Element {
  const locale = useLocale();
  const view = useRef<Terminal>(null);
  const [records, setRecords] = useState<TerminalRecord[] | null>(null);
  const [selectedId, select] = useState<string>();
  const [focusId, setFocusId] = useState<string>();
  const [opening, setOpening] = useState(false);
  const [retry, refresh] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const selected = records?.find(({ id }) => id === selectedId) ?? records?.at(-1);

  useEffect(() => {
    let disposed = false;
    const pending = new Map<string, TerminalRecord | null>();
    let listed = false;
    const unsubscribe = window.pi.onTerminalEvent((event) => {
      if (event.type === "output") return;
      const record = event.type === "updated" ? event.record : null;
      const owner = event.type === "updated" ? event.record : event;
      if (owner.composerId !== composerId) return;
      if (listed) setRecords((items) => setRecord(items ?? [], owner.id, record));
      else pending.set(owner.id, record);
    });
    void window.pi.sessionTerminals(composerId).then(
      (items) => {
        if (disposed) return;
        listed = true;
        for (const [id, record] of pending) items = setRecord(items, id, record);
        pending.clear();
        setRecords(items);
      },
      (error: unknown) => {
        if (!disposed) setListError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [composerId, retry]);

  const open = async (): Promise<void> => {
    if (!workingDirectory || opening) return;
    setOpening(true);
    setOpenError(null);
    try {
      const record = await window.pi.sessionOpenTerminal(
        composerId,
        workingDirectory,
        DEFAULT_TERMINAL_SIZE,
      );
      if (selected?.id === record.id) view.current?.focus();
      setRecords((items) =>
        items?.some(({ id }) => id === record.id)
          ? items
          : setRecord(items ?? [], record.id, record),
      );
      select(record.id);
      setFocusId(record.id);
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  const copy = (): void => {
    if (!view.current) return;
    const text = terminalText(view.current);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => showFeedback("已复制输出"),
      (error: unknown) => showFeedbackError("无法复制输出。请重试。", error),
    );
  };

  if (listError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 p-3 text-xs text-destructive">
        <span>{localizeError(listError, locale)}</span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => {
            setListError(null);
            refresh((value) => value + 1);
          }}
        >
          {t("重试加载终端", locale)}
        </Button>
      </div>
    );
  if (!records)
    return (
      <p role="status" className="p-3 text-xs text-muted-foreground">
        {t("正在加载终端…", locale)}
      </p>
    );

  const openLabel = t("打开终端", locale);
  const copyLabel = t("复制输出", locale);
  const stopLabel = t(selected?.source === "agent" ? "停止后台命令" : "停止终端", locale);
  const chooser = t("选择终端或后台命令", locale);
  const problem = openError
    ? localizeError(openError, locale)
    : selected?.error
      ? localizeError(selected.error, locale)
      : selected?.status === "failed"
        ? selected.exitCode === undefined
          ? t("进程意外退出。可查看下方输出。", locale)
          : t("进程以退出码 {0} 结束。可查看下方输出。", locale, [selected.exitCode])
        : null;

  return (
    <section data-terminal-panel className="flex min-h-0 min-w-0 flex-1 flex-col">
      {selected ? (
        <>
          <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 justify-start rounded-lg"
                  />
                }
                aria-label={chooser}
                title={chooser}
              >
                <TerminalIcon aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">{terminalName(selected)}</span>
                <ChevronDownIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-w-[min(28rem,calc(100vw-2rem))]">
                {records.toReversed().map((record) => (
                  <DropdownMenuItem
                    key={record.id}
                    aria-current={record.id === selected.id ? "true" : undefined}
                    className="items-start"
                    onClick={() => {
                      select(record.id);
                      setFocusId(undefined);
                      setOpenError(null);
                    }}
                  >
                    <TerminalIcon aria-hidden="true" className="mt-0.5" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate" title={terminalName(record)}>
                        {terminalName(record)}
                      </span>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={record.workingDirectory}
                      >
                        {t(record.source === "agent" ? "Agent 后台命令" : "交互式终端", locale)}
                        {" / "}
                        {t(TERMINAL_STATUS_LABELS[record.status], locale)}
                      </span>
                    </span>
                    {record.id === selected.id && (
                      <CheckIcon aria-hidden="true" className="mt-0.5" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={!workingDirectory || opening}
              aria-label={openLabel}
              title={openLabel}
              onClick={() => void open()}
            >
              <PlusIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={copyLabel}
              title={copyLabel}
              onClick={copy}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={selected.status !== "running"}
              focusableWhenDisabled
              aria-label={stopLabel}
              title={stopLabel}
              onClick={() =>
                void window.pi
                  .sessionStopTerminal(composerId, selected.id)
                  .catch((error: unknown) => showFeedbackError("无法停止进程。请重试。", error))
              }
            >
              <SquareIcon aria-hidden="true" />
            </Button>
          </div>
          <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate" title={selected.workingDirectory}>
              {selected.workingDirectory}
            </span>
            <TerminalStatus record={selected} />
          </div>
        </>
      ) : (
        <div className="flex shrink-0 flex-col items-start gap-2 px-3 py-4">
          {workingDirectory ? (
            <>
              <Button size="sm" disabled={opening} onClick={() => void open()}>
                <TerminalIcon data-icon="inline-start" aria-hidden="true" />
                {t(opening ? "正在打开终端…" : "打开终端", locale)}
              </Button>
              <p
                className="max-w-full truncate text-xs text-muted-foreground"
                title={workingDirectory}
              >
                {workingDirectory}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("先打开项目或在设置中选择工具工作目录。", locale)}
            </p>
          )}
        </div>
      )}
      {problem && (
        <p role="alert" className="shrink-0 px-3 pb-2 text-xs break-words text-destructive">
          {problem}
        </p>
      )}
      {selected && (
        <TerminalViewport
          key={selected.id}
          record={selected}
          view={view}
          focus={focusId === selected.id}
          onCopy={copy}
        />
      )}
    </section>
  );
}
