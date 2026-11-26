// @env browser
import { useState, type JSX } from "react";

import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { localizeError, t } from "@renderer/lib/i18n";
import type { Locale } from "@shared/contract";
import {
  MCP_REGISTRY_MIN_QUERY,
  type McpRegistryConnection,
  type McpRegistryEntry,
} from "@shared/discovery";

import { DiscoveryHeading } from "./DiscoveryHeading";

export function McpRegistryDiscovery({
  locale,
  saved,
  onBack,
  onSelect,
}: {
  locale: Locale;
  saved: boolean;
  onBack(): void;
  onSelect(
    entry: McpRegistryEntry,
    connection: McpRegistryConnection,
    trigger: HTMLButtonElement,
  ): void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [entries, setEntries] = useState<McpRegistryEntry[]>();
  const [cursor, setCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = query.trim();
  const short = Boolean(trimmed) && [...trimmed].length < MCP_REGISTRY_MIN_QUERY;

  const search = async (needle: string, after?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const page = await window.pi.searchMcpRegistry(needle, after);
      if (after) {
        setEntries((previous) => {
          const seen = new Set(previous?.map(({ id, version }) => id + "@" + version));
          return [
            ...(previous ?? []),
            ...page.entries.filter(({ id, version }) => !seen.has(id + "@" + version)),
          ];
        });
      } else {
        setSubmitted(needle);
        setEntries(page.entries);
      }
      setCursor(page.cursor === after ? undefined : page.cursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid min-w-0 gap-4" data-discovery="mcp">
      <DiscoveryHeading
        title={t("MCP Registry", locale)}
        back={t("返回 MCP 服务", locale)}
        onBack={onBack}
      />
      <form
        className="grid min-w-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!short) void search(trimmed);
        }}
      >
        <label htmlFor="mcp-registry-query" className="text-sm font-medium">
          {t("按名称搜索 MCP 服务", locale)}
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input
            type="search"
            id="mcp-registry-query"
            className="min-w-0 flex-1 basis-44"
            value={query}
            maxLength={200}
            aria-describedby="mcp-registry-query-help"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || short}>
            {t("搜索", locale)}
          </Button>
        </div>
        <p id="mcp-registry-query-help" className="text-xs text-muted-foreground">
          {t("名称至少输入 {0} 个字符。留空可浏览目录。", locale, [MCP_REGISTRY_MIN_QUERY])}
        </p>
      </form>
      {busy && (
        <output className="text-xs text-muted-foreground">
          {t("正在搜索 MCP Registry…", locale)}
        </output>
      )}
      {error && (
        <p role="alert" className="text-xs wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      {saved && (
        <output className="text-xs text-muted-foreground">
          {t("已保存 MCP 配置。可返回服务列表启用。", locale)}
        </output>
      )}
      {entries && (
        <div className="settings-list" aria-busy={busy}>
          {entries.length === 0 && (
            <ListEmpty
              title={t("没有匹配的 MCP 服务", locale)}
              description={t("换一个名称再搜索。", locale)}
            />
          )}
          {entries.map((entry) => (
            <article
              key={entry.id + "@" + entry.version}
              className="grid min-w-0 gap-2 py-3"
              data-registry-entry={entry.id}
            >
              <div className="grid min-w-0 gap-0.5">
                <h3 className="text-sm font-medium wrap-anywhere">{entry.name}</h3>
                {entry.description && (
                  <p className="text-xs wrap-anywhere text-muted-foreground">{entry.description}</p>
                )}
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  {t("发布者 {0}", locale, [entry.publisher])}
                  {" · "}
                  {t("版本 {0}", locale, [entry.version])}
                </p>
                <p className="text-xs wrap-anywhere text-muted-foreground">{entry.id}</p>
                {entry.repository && (
                  <p className="text-xs wrap-anywhere text-muted-foreground">{entry.repository}</p>
                )}
              </div>
              {entry.connections.map((connection, index) => {
                const { transport } = connection;
                const label = transport.type === "http" ? "Streamable HTTP" : "stdio";
                const launch =
                  transport.type === "http"
                    ? transport.url
                    : [transport.command, ...transport.args.map((arg) => JSON.stringify(arg))].join(
                        " ",
                      );
                return (
                  <div key={label + index} className="flex min-w-0 flex-wrap items-end gap-2">
                    <div className="grid min-w-0 flex-1 basis-44 gap-0.5">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <code className="text-xs wrap-anywhere">{launch}</code>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(event) => onSelect(entry, connection, event.currentTarget)}
                    >
                      {t("填入配置", locale)}
                    </Button>
                  </div>
                );
              })}
              {!entry.connections.length && (
                <p className="text-xs text-muted-foreground">
                  {t("此条目没有受支持的连接方式。", locale)}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
      {cursor && (
        <Button
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={busy}
          onClick={() => void search(submitted, cursor)}
        >
          {t("加载更多", locale)}
        </Button>
      )}
    </section>
  );
}
