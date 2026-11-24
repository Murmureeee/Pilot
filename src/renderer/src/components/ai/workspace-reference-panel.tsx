// @env browser
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { ChevronRightIcon, FileTextIcon, FolderIcon, XIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { WorkspaceReferenceLoad, WorkspaceReferenceTab } from "@renderer/lib/types";
import { referenceName } from "@renderer/lib/workspace-links";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";

function FileText({ text, line }: { text: string; line?: number }): JSX.Element {
  const lines = useMemo(() => text.replace(/\r\n?/g, "\n").split("\n"), [text]);
  const numbers = useMemo(() => lines.map((_, index) => index + 1).join("\n"), [lines]);
  const target = line && line <= lines.length ? line - 1 : null;
  return (
    <div className="flex w-max min-w-full items-stretch py-2 font-mono text-xs leading-5">
      <pre
        className="bg-background text-muted-foreground sticky left-0 me-3 shrink-0 border-r px-2.5 text-right select-none"
        aria-hidden="true"
      >
        {numbers}
      </pre>
      <pre className="min-w-0 pr-3">
        <code>
          {target === null ? (
            lines.join("\n")
          ) : (
            <>
              {target > 0 && lines.slice(0, target).join("\n") + "\n"}
              <mark
                className="bg-accent text-foreground rounded-xs px-0.5"
                data-reference-line={line}
              >
                {lines[target] || " "}
              </mark>
              {target < lines.length - 1 && "\n" + lines.slice(target + 1).join("\n")}
            </>
          )}
        </code>
      </pre>
    </div>
  );
}

export function WorkspaceReferencePanel({
  reference,
}: {
  reference: WorkspaceReferenceTab;
}): JSX.Element {
  const locale = useLocale();
  const [loaded, setLoaded] = useState<WorkspaceReferenceLoad | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const { path, line, workingDirectory } = reference;
  const current = loaded?.reference === reference ? loaded : null;
  const preview = current && "preview" in current ? current.preview : null;
  const error = current && "error" in current ? current.error : null;
  const kind = preview?.kind ?? reference.kind;
  const Icon = kind === "directory" ? FolderIcon : FileTextIcon;
  const title = referenceName(path);

  useEffect(() => {
    let active = true;
    void window.pi.previewWorkspaceReference({ path, workingDirectory }).then(
      (preview) => {
        if (active) setLoaded({ reference, preview });
      },
      (error: unknown) => {
        if (active)
          setLoaded({ reference, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path, reference, workingDirectory]);

  useLayoutEffect(() => {
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      focused !== document.body &&
      !panel.current?.contains(focused)
    ) {
      trigger.current = focused;
    }
    closeButton.current?.focus({ preventScroll: true });
  }, [reference]);

  useLayoutEffect(() => {
    const viewport = body.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
    const target = viewport.querySelector("[data-reference-line]");
    if (target)
      viewport.scrollTop =
        target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24;
  }, [current]);

  const close = (): void => {
    useWorkspaceReferenceStore.getState().close();
    trigger.current?.focus({ preventScroll: true });
  };

  return (
    <aside
      ref={panel}
      data-workspace-reference-panel
      aria-label={t("引用预览", locale)}
      className="border-border bg-background flex w-[min(46%,42rem)] min-w-0 shrink-0 flex-col border-l"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
      }}
    >
      <header className="border-border/65 flex h-10 shrink-0 items-center justify-between gap-2 border-b pr-2 pl-3">
        <h2
          title={path}
          className="bg-secondary text-secondary-foreground flex h-7 min-w-0 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium"
        >
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </h2>
        <Button
          ref={closeButton}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("关闭预览", locale)}
          title={t("关闭预览", locale)}
          onClick={close}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </header>
      <div
        ref={body}
        tabIndex={preview?.kind === "file" && preview.text ? 0 : undefined}
        className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
      >
        {!current && (
          <p role="status" className="text-muted-foreground px-3 py-4 text-xs">
            {t("加载中…", locale)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-muted-foreground px-3 py-4 text-xs">
            {localizeError(error, locale)}
          </p>
        )}
        {preview?.kind === "file" &&
          (preview.text ? (
            <FileText text={preview.text} line={line} />
          ) : (
            <p className="text-muted-foreground px-3 py-4 text-xs">
              {t(preview.text === null ? "此文件无法在应用内预览。" : "空文件", locale)}
            </p>
          ))}
        {preview?.kind === "directory" && (
          <ul className="space-y-0.5 p-2">
            {preview.entries.map((entry) => {
              const EntryIcon = entry.kind === "directory" ? FolderIcon : FileTextIcon;
              return (
                <li key={entry.path}>
                  <button
                    type="button"
                    title={entry.path}
                    className="hover:bg-muted focus-visible:ring-ring/50 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2"
                    onClick={() =>
                      useWorkspaceReferenceStore.getState().open({
                        sessionId: reference.sessionId,
                        workingDirectory,
                        path: entry.path,
                        kind: entry.kind,
                      })
                    }
                  >
                    <EntryIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{referenceName(entry.path)}</span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-3.5 shrink-0"
                    />
                  </button>
                </li>
              );
            })}
            {preview.entries.length === 0 && !preview.truncated && (
              <li className="text-muted-foreground px-2 py-2 text-xs">{t("空文件夹", locale)}</li>
            )}
            {preview.truncated && (
              <li className="text-muted-foreground px-2 py-2 text-xs">
                {t("仅显示部分目录内容", locale)}
              </li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
}
