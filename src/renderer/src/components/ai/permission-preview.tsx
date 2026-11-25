// @env browser
import type { JSX } from "react";

import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { PermissionRequest } from "@shared/contract";
import { toolInput } from "@shared/tool-input";

import { DiffLines } from "./file-diff-preview";

export function PermissionPreview({ request }: { request: PermissionRequest }): JSX.Element | null {
  const locale = useLocale();
  const diff = request.file?.diff;
  if (request.file && diff) {
    const label = t("拟议文件差异", locale);
    return (
      <div className="grid min-w-0 gap-1">
        <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
        <div
          role="region"
          aria-label={label}
          tabIndex={0}
          data-permission-diff
          className="max-h-[min(25vh,12rem)] min-w-0 overflow-auto overscroll-contain rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <DiffLines diff={diff} path={request.file.path} />
        </div>
        {diff.truncated && (
          <p className="text-xs text-muted-foreground">{t("差异预览已达到显示上限。", locale)}</p>
        )}
      </div>
    );
  }

  const text =
    request.web?.query ??
    request.web?.url ??
    request.command ??
    (request.mcp ? request.inputSummary : toolInput(request.inputSummary).details);
  if (!text && !request.file?.error) return null;
  return (
    <div className="grid min-w-0 gap-1">
      {request.file?.error && (
        <p className="text-xs wrap-anywhere text-muted-foreground" data-permission-preview-error>
          {localizeError(request.file.error, locale)}
        </p>
      )}
      {text && (
        <CodeBlock size="sm" variant={request.danger ? "destructive" : "default"}>
          <CodeBlockContent
            aria-label={t(
              request.web
                ? request.web.query === undefined
                  ? "网页地址"
                  : "搜索词"
                : request.command === undefined
                  ? "参数"
                  : "命令",
              locale,
            )}
            wrap
            tabIndex={0}
            data-permission-input
            className="max-h-[min(23vh,11rem)] overscroll-contain focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {text}
          </CodeBlockContent>
        </CodeBlock>
      )}
    </div>
  );
}
