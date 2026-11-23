// @env browser
import { useMemo, useState, type JSX } from "react";
import { SearchIcon, TrashIcon } from "lucide-react";
import { SessionDeleteDialog } from "@renderer/components/ai/session-delete-dialog";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { t, useLocale } from "@renderer/lib/i18n";
import { relativeTime } from "@renderer/lib/relative-time";
import { useAgentStore } from "@renderer/stores/agent";
import type { SessionMeta } from "@shared/contract";

export function ArchivedSettings(): JSX.Element {
  const locale = useLocale();
  const sessions = useAgentStore((s) => s.sessions);
  const loadSession = useAgentStore((s) => s.loadSession);
  const setSessionArchived = useAgentStore((s) => s.setSessionArchived);
  const setView = useAgentStore((s) => s.setView);
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null);
  const archived = useMemo(() => sessions.filter((session) => session.archived), [sessions]);
  const search = query.trim().toLowerCase();
  const visible = archived.filter((session) => session.title.toLowerCase().includes(search));

  return (
    <div className="grid gap-3">
      {archived.length > 0 && (
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            aria-label={t("搜索已归档的聊天", locale)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("搜索已归档的聊天", locale)}
            className="h-9 rounded-lg pl-9"
          />
        </div>
      )}
      <div className="settings-list">
        {visible.length === 0 && (
          <p className="text-muted-foreground py-4 text-sm">
            {t(archived.length > 0 ? "没有匹配的聊天" : "没有已归档的聊天", locale)}
          </p>
        )}
        {visible.map((session) => (
          <div key={session.id} className="settings-row gap-x-3">
            <div className="min-w-0 flex-1 basis-40">
              <button
                type="button"
                onClick={() => {
                  setView("chat");
                  void loadSession(session.id);
                }}
                className="block max-w-full truncate text-left text-sm hover:underline"
                title={session.title}
              >
                {session.title}
              </button>
              <p className="text-muted-foreground text-xs">
                {relativeTime(session.updatedAt, locale)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void setSessionArchived(session.id, false)}
              >
                {t("取消归档", locale)}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("永久删除", locale)}
                title={t("永久删除", locale)}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setDeleteTarget(session)}
              >
                <TrashIcon />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <SessionDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
