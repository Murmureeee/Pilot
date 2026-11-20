// @env browser
// Reasoning 思考块（FR-4.5）：流式收集中自动展开观察，结束后自动折叠为一行摘要；
// 点击头部可随时展开全文。折叠态摘要用单行截断（muted，次级信息规范）。
import { useState, type JSX } from "react";
import { BrainIcon, ChevronDownIcon, LoaderCircleIcon } from "lucide-react";
import { t, useLocale } from "@renderer/lib/i18n";
import { cn } from "cn";

export function ThinkingBlock({
  text,
  streaming,
}: {
  text: string;
  /** 本块仍在接收 thinking_delta（自动展开）；结束后自动折叠 */
  streaming: boolean;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const expanded = streaming || open;
  const summary = text.trimStart().split("\n")[0] ?? "";

  return (
    <div className="border-border/60 bg-muted/40 rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground hover:bg-accent/50 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors"
      >
        {streaming ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : (
          <BrainIcon className="size-3.5" />
        )}
        <span className={cn("min-w-0 flex-1 truncate text-left", streaming && "text-foreground")}>
          {streaming ? t("思考中…", locale) : summary || t("思考过程", locale)}
        </span>
        <ChevronDownIcon
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && text.length > 0 && (
        <div className="text-muted-foreground max-h-64 overflow-y-auto border-t px-3 py-2 text-xs whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}
