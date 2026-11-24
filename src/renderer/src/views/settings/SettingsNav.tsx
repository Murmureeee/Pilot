// @env browser
import { useState, type JSX } from "react";
import {
  ArchiveIcon,
  BlocksIcon,
  BotIcon,
  DownloadIcon,
  HardDriveIcon,
  InfoIcon,
  KeyboardIcon,
  PaletteIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import { Input } from "@renderer/components/ui/input";
import {
  SETTINGS_SECTION_DESCRIPTIONS,
  SETTINGS_SECTION_KEYWORDS,
  SETTINGS_SECTION_LABELS,
} from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import type { SettingsSection } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";

const SETTINGS_NAV: {
  label: string;
  items: { id: SettingsSection; icon: typeof BotIcon }[];
}[] = [
  {
    label: "应用",
    items: [
      { id: "general", icon: SettingsIcon },
      { id: "appearance", icon: PaletteIcon },
      { id: "permissions", icon: ShieldCheckIcon },
      { id: "providers", icon: BotIcon },
      { id: "persona", icon: UserRoundIcon },
      { id: "shortcuts", icon: KeyboardIcon },
    ],
  },
  {
    label: "集成",
    items: [
      { id: "skills", icon: BlocksIcon },
      { id: "mcp", icon: PlugIcon },
      { id: "imports", icon: DownloadIcon },
    ],
  },
  {
    label: "数据",
    items: [
      { id: "archived", icon: ArchiveIcon },
      { id: "data", icon: HardDriveIcon },
    ],
  },
  {
    label: "Pilot",
    items: [{ id: "about", icon: InfoIcon }],
  },
];

// 搜索词留在组件内：离开设置视图时组件卸载，下次进入不会残留上一次的过滤结果。
export function SettingsNav(): JSX.Element {
  const locale = useLocale();
  const section = useAgentStore((s) => s.settingsSection);
  const setSection = useAgentStore((s) => s.setSettingsSection);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const groups = SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.filter(({ id }) =>
      [
        SETTINGS_SECTION_LABELS[id],
        SETTINGS_SECTION_DESCRIPTIONS[id],
        ...SETTINGS_SECTION_KEYWORDS[id],
      ].some((text) => t(text, locale).toLowerCase().includes(search)),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <nav aria-label={t("设置", locale)} className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
      <div className="relative mb-3.5">
        <SearchIcon
          aria-hidden="true"
          className="text-sidebar-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        />
        <Input
          type="search"
          aria-label={t("搜索设置", locale)}
          placeholder={t("搜索设置", locale)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            const first = groups[0]?.items[0];
            if (event.key === "Enter" && search && first) setSection(first.id);
          }}
          className="h-8 pl-8 text-[13px]"
        />
      </div>
      <div className="flex flex-col gap-3.5">
        {groups.length === 0 && (
          <p className="text-sidebar-foreground/70 px-2.5 text-xs">{t("没有匹配的设置", locale)}</p>
        )}
        {groups.map((group) => (
          <section key={group.label} className="grid gap-1.5">
            <h3 className="text-sidebar-foreground/70 px-2.5 text-xs">{t(group.label, locale)}</h3>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ id, icon: Icon }) => {
                const selected = section === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSection(id)}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "hover:bg-sidebar-accent/65 focus-visible:ring-sidebar-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                      selected && "bg-sidebar-accent",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className="text-sidebar-foreground/70 size-4 shrink-0"
                      strokeWidth={1.7}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t(SETTINGS_SECTION_LABELS[id], locale)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </nav>
  );
}
