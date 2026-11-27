// @env browser
import { cn } from "cn";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CircleIcon,
  CopyIcon,
  GitForkIcon,
  LoaderCircleIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ScrollTextIcon,
  Trash2Icon,
} from "lucide-react";
import type { JSX } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@renderer/components/ui/context-menu";
import { SESSION_STATUS_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { relativeTime } from "@renderer/lib/relative-time";
import type { SessionRowStatus } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS } from "@shared/constants";
import type { SessionMeta } from "@shared/contract";

const ROW_ACTION =
  "hover:bg-foreground/10 hover:text-foreground text-muted-foreground rounded-sm p-1 transition-colors";

/** 状态位始终占位，标题才能在有无状态的行之间对齐。 */
function SessionStatusMark({ status }: { status: SessionRowStatus | null }): JSX.Element {
  const locale = useLocale();
  const spinning = status === "running" || status === "stopping";
  return (
    <span
      className="grid size-3 shrink-0 place-items-center"
      data-session-status={status ?? undefined}
      title={status ? t(SESSION_STATUS_LABELS[status], locale) : undefined}
    >
      {status && (
        <>
          {spinning ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className={cn(
                "size-3 motion-safe:animate-spin",
                status === "running"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                (status === "approval" || status === "plan") && "bg-amber-500",
                status === "failed" && "bg-destructive",
                status === "interrupted" && "border border-muted-foreground",
                status === "unread" && "bg-brand",
              )}
            />
          )}
          <span className="sr-only">{t(SESSION_STATUS_LABELS[status], locale)}</span>
        </>
      )}
    </span>
  );
}

export function SessionRow({
  session,
  current,
  status,
  nested,
  onRename,
  onPersona,
  onDelete,
}: {
  session: SessionMeta;
  current: boolean;
  status: SessionRowStatus | null;
  nested: boolean;
  onRename(session: SessionMeta): void;
  onPersona(session: SessionMeta): void;
  onDelete(session: SessionMeta): void;
}): JSX.Element {
  const locale = useLocale();
  return (
    <ContextMenu key={session.id}>
      <ContextMenuTrigger
        render={
          <div
            className={cn(
              "group relative flex items-center rounded-lg transition-colors hover:bg-sidebar-accent/65",
              current && "bg-sidebar-accent",
            )}
          >
            <button
              type="button"
              onClick={() => void useAgentStore.getState().loadSession(session.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset",
                nested ? "pl-7" : "pl-2.5",
              )}
              data-session-id={session.id}
              aria-current={current ? "page" : undefined}
              title={
                session.title +
                "\n" +
                new Date(session.updatedAt).toLocaleString(LOCALE_DETAILS[locale].htmlLang)
              }
            >
              <SessionStatusMark status={status} />
              {session.pinned && !session.archived && (
                <PinIcon
                  className="-mr-0.5 size-3 shrink-0 text-muted-foreground"
                  aria-label={t("置顶", locale)}
                />
              )}
              <span className={cn("min-w-0 flex-1 truncate", session.unread && "font-medium")}>
                {session.title}
              </span>
              {/* 只认键盘焦点：鼠标点开会话后焦点留在行上，不该一直把时间换成按钮。 */}
              <span className="shrink-0 text-xs text-muted-foreground group-hover:hidden group-has-[:focus-visible]:hidden">
                {relativeTime(session.updatedAt, locale)}
              </span>
            </button>
            <div className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex group-has-[:focus-visible]:flex">
              {!session.archived && (
                <button
                  type="button"
                  aria-label={session.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  title={session.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  onClick={() =>
                    void useAgentStore.getState().setSessionPinned(session.id, !session.pinned)
                  }
                  className={ROW_ACTION}
                >
                  {session.pinned ? (
                    <PinOffIcon className="size-3.5" />
                  ) : (
                    <PinIcon className="size-3.5" />
                  )}
                </button>
              )}
              {session.archived ? (
                <button
                  type="button"
                  aria-label={t("取消归档", locale)}
                  title={t("取消归档", locale)}
                  onClick={() =>
                    void useAgentStore.getState().setSessionArchived(session.id, false)
                  }
                  className={ROW_ACTION}
                >
                  <ArchiveRestoreIcon className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("归档聊天", locale)}
                  title={t("归档聊天", locale)}
                  onClick={() => void useAgentStore.getState().setSessionArchived(session.id, true)}
                  className={ROW_ACTION}
                >
                  <ArchiveIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        }
      />
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onClick={() => onRename(session)}>
          <PencilIcon className="size-4" /> {t("重命名", locale)}
        </ContextMenuItem>
        {!session.archived && (
          <ContextMenuItem
            onClick={() =>
              void useAgentStore.getState().setSessionPinned(session.id, !session.pinned)
            }
          >
            <PinIcon className="size-4" />{" "}
            {session.pinned ? t("取消置顶", locale) : t("置顶", locale)}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() =>
            void useAgentStore.getState().setSessionUnread(session.id, !session.unread)
          }
        >
          <CircleIcon className="size-4" />{" "}
          {session.unread ? t("标记为已读", locale) : t("标记为未读", locale)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void useAgentStore.getState().forkSession(session.id)}>
          <GitForkIcon className="size-4" /> {t("分叉", locale)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void useAgentStore.getState().copySession(session.id)}>
          <CopyIcon className="size-4" /> {t("复制全文", locale)}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() =>
            void useAgentStore.getState().setSessionArchived(session.id, !session.archived)
          }
        >
          {session.archived ? (
            <ArchiveRestoreIcon className="size-4" />
          ) : (
            <ArchiveIcon className="size-4" />
          )}
          {session.archived ? t("取消归档", locale) : t("归档", locale)}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onPersona(session)}>
          <ScrollTextIcon className="size-4" />{" "}
          {session.personaOverride ? t("会话指令（已覆盖）", locale) : t("会话指令…", locale)}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => onDelete(session)}>
          <Trash2Icon className="size-4" /> {t("永久删除", locale)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
