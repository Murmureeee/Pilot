// @env browser
import {
  Component,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { applyTheme, loadTheme } from "@renderer/lib/theme";
import { LOCALE_DETAILS } from "@shared/constants";

export class AppErrorBoundary extends Component<PropsWithChildren, { reason: string | null }> {
  override state: Readonly<{ reason: string | null }> = { reason: null };

  static getDerivedStateFromError(error: unknown): { reason: string } {
    const reason = error instanceof Error ? error.message || error.name : error;
    return { reason: typeof reason === "string" && reason.trim() ? reason : "无法确定错误原因。" };
  }

  override render(): ReactNode {
    const { reason } = this.state;
    return reason === null ? this.props.children : <AppErrorPage reason={reason} />;
  }
}

function AppErrorPage({ reason }: { reason: string }): JSX.Element {
  const locale = useLocale();
  const reloadButton = useRef<HTMLButtonElement>(null);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    applyTheme(loadTheme());
    reloadButton.current?.focus();
  }, []);

  async function reload(): Promise<void> {
    setActionError(undefined);
    try {
      await window.pi.menuAction("reload");
    } catch {
      setActionError("无法重新加载界面。");
    }
  }

  async function openLogs(): Promise<void> {
    setActionError(undefined);
    try {
      if (!(await window.pi.openPath("logs"))) return;
    } catch {
      // Keep the reload action accessible when opening the folder fails.
    }
    setActionError("无法打开日志目录。");
  }

  return (
    <div
      lang={LOCALE_DETAILS[locale].htmlLang}
      className="bg-window-frame text-foreground grid h-screen grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] gap-1.5 px-2.5 pb-2.5"
    >
      <div className="app-drag" aria-hidden="true" />
      <main className="border-sidebar-border bg-background overflow-y-auto rounded-xl border p-6">
        <div className="mx-auto flex min-h-full max-w-lg items-center">
          <Alert variant="destructive">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertTitle>{t("界面发生错误", locale)}</AlertTitle>
            <AlertDescription className="col-start-2 grid gap-2">
              <p
                id="app-error-reason"
                className="max-h-32 overflow-auto wrap-anywhere whitespace-pre-wrap"
              >
                {localizeError(reason, locale)}
              </p>
              <p>{t("重新加载后可返回当前会话。正在运行的任务会继续。", locale)}</p>
              {actionError && (
                <p role="alert" className="text-destructive">
                  {t(actionError, locale)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={reloadButton}
                  size="sm"
                  aria-describedby="app-error-reason"
                  onClick={() => void reload()}
                >
                  {t("重新加载", locale)}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void openLogs()}>
                  {t("查看日志", locale)}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      </main>
    </div>
  );
}
