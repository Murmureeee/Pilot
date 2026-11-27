// @env browser
import type { WebviewTag } from "electron";
import { CameraIcon, RotateCwIcon, TerminalIcon } from "lucide-react";
import { createElement, useCallback, useRef, useState, type FormEvent, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { IMAGE_ATTACHMENT_LIMIT } from "@shared/constants";
import { PREVIEW_PARTITION } from "@shared/page-preview";

export function PagePreviewPanel({
  composerId,
  canEdit,
  onAppend,
}: {
  composerId: string;
  canEdit: boolean;
  onAppend(text: string): void;
}): JSX.Element {
  const locale = useLocale();
  const [address, setAddress] = useState("");
  const [opened, setOpened] = useState("");
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [openError, setOpenError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reportError, setReportError] = useState("");
  const [messages, setMessages] = useState(false);
  const view = useRef<WebviewTag>(null);
  const bindView = useCallback(
    (element: HTMLElement | null): (() => void) | undefined => {
      if (!element) return;
      const guest = element as WebviewTag;
      view.current = guest;
      const cleanup = new AbortController();
      let finished = false;
      const start = (): void => {
        finished = false;
        setLoading(true);
        setLoaded(false);
        setMessages(false);
        setLoadError("");
        setReportError("");
      };
      element.addEventListener("did-start-loading", start, { signal: cleanup.signal });
      element.addEventListener(
        "did-finish-load",
        () => {
          finished = true;
          setLoading(false);
          setLoaded(true);
        },
        { signal: cleanup.signal },
      );
      element.addEventListener(
        "did-fail-load",
        (event) => {
          const failure = event as unknown as Electron.DidFailLoadEvent;
          if (!failure.isMainFrame) return;
          finished = true;
          setLoading(false);
          setLoaded(false);
          setLoadError(failure.errorDescription);
        },
        { signal: cleanup.signal },
      );
      element.addEventListener(
        "did-stop-loading",
        () => {
          setLoading(false);
          if (!finished) setLoadError("ERR_PREVIEW_NAVIGATION_STOPPED");
        },
        { signal: cleanup.signal },
      );
      element.addEventListener(
        "render-process-gone",
        () => {
          setLoading(false);
          setLoaded(false);
          setLoadError("ERR_PREVIEW_PROCESS_GONE");
        },
        { signal: cleanup.signal },
      );
      element.addEventListener(
        "console-message",
        (event) => {
          if ((event as unknown as Electron.ConsoleMessageEvent).level === 3) setMessages(true);
        },
        { signal: cleanup.signal },
      );
      if (guest.src !== opened) {
        guest.partition = PREVIEW_PARTITION;
        guest.src = opened;
      }
      return () => {
        cleanup.abort();
        if (view.current === guest) view.current = null;
      };
    },
    [opened],
  );

  const open = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (opening) return;
    setOpening(true);
    setOpenError("");
    try {
      const next = await window.pi.preparePagePreview(address);
      if (opened === next) {
        view.current?.reload();
        return;
      }
      setLoadError("");
      setReportError("");
      setLoading(true);
      setLoaded(false);
      setMessages(false);
      setOpened(next);
    } catch (cause) {
      setOpenError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOpening(false);
    }
  };

  const append = async (includeScreenshot: boolean): Promise<void> => {
    const guest = view.current;
    if (!guest || sending || !canEdit) return;
    setSending(true);
    setReportError("");
    try {
      const report = await window.pi.pagePreviewReport(guest.getWebContentsId(), includeScreenshot);
      const store = useAgentStore.getState();
      if (view.current !== guest || store.composerId !== composerId) return;
      if (report.screenshot) {
        if (store.draftImages.length >= IMAGE_ATTACHMENT_LIMIT) {
          setReportError(t("每条消息最多可添加 {0} 张图片。", locale, [IMAGE_ATTACHMENT_LIMIT]));
          return;
        }
        await store.saveDraftImages(composerId, [...store.draftImages, report.screenshot]);
      }
      if (useAgentStore.getState().composerId !== composerId) return;
      const title = t("页面预览 {0}", locale, [report.address]);
      const consoleOutput = t("控制台错误", locale) + "\n" + report.errors.join("\n");
      if (includeScreenshot || report.errors.length)
        onAppend(report.errors.length ? title + "\n\n" + consoleOutput : title);
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form className="flex shrink-0 flex-col gap-2 border-b border-border/65 p-3" onSubmit={open}>
        <label className="text-sm font-medium" htmlFor="page-preview-address">
          {t("本机开发服务器地址", locale)}
        </label>
        <div className="flex items-center gap-1.5">
          <Input
            id="page-preview-address"
            className="min-w-0 flex-1"
            value={address}
            onChange={(event) => {
              setOpenError("");
              setAddress(event.target.value);
            }}
            placeholder="http://localhost:5173"
            autoComplete="off"
            spellCheck={false}
            maxLength={2048}
            aria-invalid={Boolean(openError)}
            aria-describedby={openError ? "page-preview-address-error" : undefined}
          />
          <Button type="submit" disabled={opening || !address.trim()}>
            {t("打开页面", locale)}
          </Button>
          {opened && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("重新加载页面", locale)}
              title={t("重新加载页面", locale)}
              disabled={loading || opening}
              onClick={() => view.current?.reload()}
            >
              <RotateCwIcon aria-hidden="true" />
            </Button>
          )}
        </div>
        {openError && (
          <p id="page-preview-address-error" role="alert" className="text-xs text-destructive">
            {localizeError(openError, locale)}
          </p>
        )}
      </form>
      {!opened && (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          {t("在终端启动开发服务器，再输入地址打开页面。", locale)}
        </p>
      )}
      {loading && (
        <p className="px-3 py-2 text-xs text-muted-foreground" role="status">
          {t("正在打开页面…", locale)}
        </p>
      )}
      {loadError && (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          {t("打开页面失败（{0}）。请检查开发服务器后重新加载。", locale, [loadError])}
        </p>
      )}
      {opened &&
        createElement("webview", {
          key: opened,
          ref: bindView,
          className: "min-h-0 min-w-0 flex-1",
          title: t("开发页面预览", locale),
          "aria-label": t("开发页面预览", locale),
          hidden: Boolean(loadError),
        })}
      {loaded && !loadError && (
        <div className="flex shrink-0 flex-col gap-2 border-t border-border/65 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sending || !canEdit}
              onClick={() => void append(true)}
            >
              <CameraIcon aria-hidden="true" data-icon="inline-start" />
              {t("将截图加入草稿", locale)}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={sending || !canEdit || !messages}
              onClick={() => void append(false)}
            >
              <TerminalIcon aria-hidden="true" data-icon="inline-start" />
              {t("将控制台错误加入草稿", locale)}
            </Button>
          </div>
          {reportError && (
            <p role="alert" className="text-xs text-destructive">
              {localizeError(reportError, locale)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
