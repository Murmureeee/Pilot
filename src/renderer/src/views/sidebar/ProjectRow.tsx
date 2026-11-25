// @env browser
import { cn } from "cn";
import {
  ChevronRightIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  ListMinusIcon,
  SquarePenIcon,
} from "lucide-react";
import { useRef, useState, type JSX, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { showFeedback } from "@renderer/lib/feedback";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { ProjectRowAction } from "@renderer/lib/types";
import { referenceName } from "@renderer/lib/workspace-links";

export function ProjectRow({
  directory,
  parent,
  recent,
  current,
  expanded,
  hasChats,
  choosing,
  onToggle,
  onNewChat,
  onRemoved,
  children,
}: {
  directory: string;
  parent?: string;
  recent: boolean;
  current: boolean;
  expanded: boolean;
  hasChats: boolean;
  choosing: boolean;
  onToggle(): void;
  onNewChat(): void;
  onRemoved(): void;
  children: ReactNode;
}): JSX.Element {
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ action: ProjectRowAction; message: string }>();
  const projectButton = useRef<HTMLButtonElement>(null);
  const name = referenceName(directory);
  const newChatLabel = t("在此项目新建聊天", locale);
  const menuLabel = t("{0} 的项目操作", locale, [name]);
  const Icon = hasChats ? ChevronRightIcon : FolderIcon;

  const perform = async (action: ProjectRowAction): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (action === "open") await window.pi.sessionOpenProjectFolder(directory);
      else {
        await window.pi.sessionRemoveRecentProject(directory);
        showFeedback("已从最近项目移除");
        onRemoved();
      }
    } catch (cause) {
      setError({ action, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-label={directory}>
      <div
        className={cn(
          "group flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/65",
          current && "bg-sidebar-accent",
        )}
      >
        <button
          ref={projectButton}
          type="button"
          data-project-directory={directory}
          aria-expanded={hasChats ? expanded : undefined}
          aria-current={current ? "location" : undefined}
          title={directory}
          disabled={!hasChats && choosing}
          onClick={hasChats ? onToggle : onNewChat}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 pl-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="truncate">{name}</span>
          {parent && (
            <span className="min-w-0 shrink-[2] truncate text-xs text-muted-foreground">
              {parent}
            </span>
          )}
        </button>
        {/* Keep the actions in the tab order when the project row was last focused with the mouse. */}
        <div className="flex w-0 shrink-0 overflow-hidden group-hover:w-auto group-hover:overflow-visible group-has-[:focus-visible]:w-auto group-has-[:focus-visible]:overflow-visible group-has-[[data-popup-open]]:w-auto group-has-[[data-popup-open]]:overflow-visible">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={newChatLabel}
            title={newChatLabel}
            disabled={choosing}
            onClick={onNewChat}
          >
            <SquarePenIcon aria-hidden="true" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={menuLabel}
                  title={menuLabel}
                  aria-busy={pending || undefined}
                  className="mr-1"
                />
              }
            >
              <EllipsisIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={pending} onClick={() => void perform("open")}>
                  <FolderOpenIcon aria-hidden="true" />
                  {t("在文件管理器中打开", locale)}
                </DropdownMenuItem>
                {recent && (
                  <DropdownMenuItem
                    disabled={pending}
                    onClick={() => void perform("remove")}
                    className="items-start"
                  >
                    <ListMinusIcon aria-hidden="true" className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                      <span>{t("从最近项目移除", locale)}</span>
                      {hasChats && (
                        <span className="text-xs text-muted-foreground">
                          {t("聊天保留在「其他项目」中。", locale)}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {error && (
        <div className="flex flex-col items-start gap-1 px-2.5 py-1.5">
          <p role="alert" className="text-xs wrap-anywhere text-destructive">
            {localizeError(error.message, locale)}
          </p>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              projectButton.current?.focus({ preventScroll: true });
              void perform(error.action);
            }}
          >
            {t("重试", locale)}
          </Button>
        </div>
      )}
      {expanded && children}
    </section>
  );
}
