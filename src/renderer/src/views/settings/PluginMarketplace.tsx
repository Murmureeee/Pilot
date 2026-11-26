// @env browser
import { useEffect, useState, type JSX } from "react";

import { ListEmpty } from "@renderer/components/ai/list-empty";
import { PluginPackageDialog } from "@renderer/components/ai/plugin-package-dialog";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { localizeError, t } from "@renderer/lib/i18n";
import type { Locale } from "@shared/contract";
import type { PluginMarketplace as Catalog, PluginMarketplaceSource } from "@shared/discovery";

import { DiscoveryHeading } from "./DiscoveryHeading";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function PluginMarketplace({
  locale,
  onBack,
  onInstalled,
}: {
  locale: Locale;
  onBack(): void;
  onInstalled(): void;
}): JSX.Element {
  const [sources, setSources] = useState<PluginMarketplaceSource[]>([]);
  const [selected, setSelected] = useState("");
  const [address, setAddress] = useState("");
  const [catalog, setCatalog] = useState<Catalog>();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    void window.pi.pluginMarketplaces().then(
      (next) => {
        if (!live) return;
        setSources(next);
        setSelected(next[0]?.location ?? "");
        setBusy(false);
      },
      (cause: unknown) => {
        if (!live) return;
        setError(messageOf(cause));
        setBusy(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const read = async (location: string, remember: boolean): Promise<void> => {
    if (busy || !location) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await window.pi.browsePluginMarketplace(location, remember);
      if (remember) {
        setSources(await window.pi.pluginMarketplaces());
        setAddress("");
      }
      setSelected(next.location);
      setCatalog(next);
      setQuery("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (busy || !selected) return;
    setBusy(true);
    setError("");
    try {
      const next = await window.pi.removePluginMarketplace(selected);
      setSources(next);
      setSelected(next[0]?.location ?? "");
      setCatalog(undefined);
      setNotice("");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const active = sources.find((source) => source.location === selected);
  const needle = query.trim().toLocaleLowerCase();
  const entries = catalog?.entries.filter((entry) =>
    [entry.key, entry.name, entry.author, entry.description].some((part) =>
      part?.toLocaleLowerCase().includes(needle),
    ),
  );
  return (
    <section className="grid min-w-0 gap-4" data-discovery="plugins">
      <DiscoveryHeading
        title={t("插件市场", locale)}
        back={t("返回技能", locale)}
        onBack={onBack}
      />
      <div className="grid min-w-0 gap-2">
        <label htmlFor="plugin-marketplace-source" className="text-sm font-medium">
          {t("市场来源", locale)}
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Select
            value={selected}
            disabled={busy}
            onValueChange={(value) => {
              if (!value || value === selected) return;
              setSelected(value);
              setCatalog(undefined);
              setError("");
              setNotice("");
            }}
          >
            <SelectTrigger id="plugin-marketplace-source" className="max-w-full min-w-0">
              <SelectValue>{active && t(active.name, locale)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-[calc(100vw-2rem)] min-w-40">
              <SelectGroup>
                {sources.map(({ location, name }) => (
                  <SelectItem key={location} value={location}>
                    {t(name, locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected}
            onClick={() => void read(selected, false)}
          >
            {t(catalog ? "刷新市场" : "浏览市场", locale)}
          </Button>
          {active && active !== sources[0] && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              {t("移除来源", locale)}
            </Button>
          )}
        </div>
        {active && <p className="text-xs wrap-anywhere text-muted-foreground">{active.location}</p>}
      </div>
      <form
        className="grid min-w-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void read(address.trim(), true);
        }}
      >
        <label htmlFor="plugin-marketplace-url" className="text-sm font-medium">
          {t("添加 Git 插件市场", locale)}
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            id="plugin-marketplace-url"
            className="min-w-0 flex-1 basis-44"
            value={address}
            maxLength={8192}
            placeholder="https://github.com/owner/repo.git"
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !address.trim()}>
            {t("添加市场", locale)}
          </Button>
        </div>
      </form>
      {busy && (
        <output className="text-xs text-muted-foreground">{t("正在读取插件市场…", locale)}</output>
      )}
      {error && (
        <p role="alert" className="text-xs wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      {notice && <output className="text-xs text-muted-foreground">{t(notice, locale)}</output>}
      {catalog && (
        <div className="grid min-w-0 gap-2">
          <label htmlFor="marketplace-filter" className="text-sm font-medium">
            {t("筛选市场插件", locale)}
          </label>
          <Input
            type="search"
            id="marketplace-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="settings-list" aria-busy={busy}>
            {entries?.length === 0 && (
              <ListEmpty
                title={t("没有匹配的插件", locale)}
                description={t("修改筛选词或换一个市场。", locale)}
              />
            )}
            {entries?.map((entry) => (
              <article
                key={entry.key}
                className="settings-row items-start"
                data-marketplace-entry={entry.key}
              >
                <div className="grid min-w-0 flex-1 basis-44 gap-0.5">
                  <h3 className="text-sm font-medium wrap-anywhere">{entry.name}</h3>
                  {entry.description && (
                    <p className="text-xs wrap-anywhere text-muted-foreground">
                      {entry.description}
                    </p>
                  )}
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {t("作者 {0}", locale, [entry.author])}
                    {" · "}
                    {t("版本 {0}", locale, [
                      entry.version ??
                        entry.source?.ref ??
                        entry.source?.sha?.slice(0, 12) ??
                        t("未声明版本", locale),
                    ])}
                  </p>
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {entry.source?.location ?? t(entry.sourceType, locale)}
                  </p>
                  {entry.source?.path && (
                    <p className="text-xs wrap-anywhere text-muted-foreground">
                      {entry.source.path}
                    </p>
                  )}
                </div>
                {entry.source ? (
                  <PluginPackageDialog
                    locale={locale}
                    source={entry.source}
                    disabled={busy}
                    onInstalled={(_items, updated) => {
                      onInstalled();
                      setNotice(
                        updated
                          ? "插件已更新，当前处于停用状态。"
                          : "插件已安装，当前处于停用状态。",
                      );
                    }}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">{t("此来源暂不可安装。", locale)}</p>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
