// @env browser
import { ChevronRightIcon, FileTextIcon, FolderIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";

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
        className="sticky left-0 me-3 shrink-0 border-r bg-background px-2.5 text-right text-muted-foreground select-none"
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
                className="rounded-xs bg-accent px-0.5 text-foreground"
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
  active,
}: {
  reference: WorkspaceReferenceTab;
  active: boolean;
}): JSX.Element {
  const locale = useLocale();
  const [loaded, setLoaded] = useState<WorkspaceReferenceLoad | null>(null);
  const [retry, setRetry] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  const lastPreview = useRef<WorkspaceReferenceLoad>(null);
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
  }, [path, reference, retry, workingDirectory]);

  useLayoutEffect(() => {
    const viewport = body.current;
    if (!active || !viewport || !current || lastPreview.current === current) return;
    lastPreview.current = current;
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
    const target = viewport.querySelector("[data-reference-line]");
    if (target)
      viewport.scrollTop =
        target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 24;
  }, [active, current]);

  return (
    <div data-workspace-reference-panel className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border/65 bg-muted/40 px-3 py-2">
        <h2 title={path} className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{title}</span>
        </h2>
      </header>
      <div
        ref={body}
        tabIndex={preview?.kind === "file" && preview.text ? 0 : undefined}
        className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {!current && (
          <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
            {t("加载中…", locale)}
          </p>
        )}
        {error && (
          <div className="flex flex-col items-start gap-2 px-3 py-4">
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoaded(null);
                setRetry((value) => value + 1);
              }}
            >
              {t("重试", locale)}
            </Button>
          </div>
        )}
        {preview?.kind === "file" &&
          (preview.text ? (
            <FileText text={preview.text} line={line} />
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
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
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
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
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate">{referenceName(entry.path)}</span>
                    <ChevronRightIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  </button>
                </li>
              );
            })}
            {preview.entries.length === 0 && !preview.truncated && (
              <li className="px-2 py-2 text-xs text-muted-foreground">{t("空文件夹", locale)}</li>
            )}
            {preview.truncated && (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {t("仅显示部分目录内容", locale)}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
