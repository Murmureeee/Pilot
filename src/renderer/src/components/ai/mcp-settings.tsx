// @env browser
import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import type { ImportReport } from "@shared/imports";
import { useEffect, useState, type JSX } from "react";
import { EllipsisIcon, PlusIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t } from "@renderer/lib/i18n";
import type { Locale } from "@shared/contract";
import type { McpServerInfo, McpServerInput, McpTransportConfig } from "@shared/mcp";

type McpDraft = McpServerInput & { transport: McpTransportConfig; imported: boolean };

function asInput({ id, name, enabled, policy }: McpServerInfo): McpServerInput {
  return { id, name, enabled, policy };
}

function readStringPairs(text: string, invalid: string): [string, string][] | undefined {
  if (!text.trim()) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value) as [string, unknown][];
      if (entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) {
        return entries;
      }
    }
  } catch {
    // A single message also covers malformed JSON and non-string values.
  }
  throw new Error(invalid);
}

export function McpSettings({
  locale,
  workingDirectory,
}: {
  locale: Locale;
  workingDirectory: string | null;
}): JSX.Element {
  const [report, setReport] = useState<ImportReport | null>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remove, setRemove] = useState<McpServerInfo | null>(null);

  const errorText = (err: unknown): string =>
    localizeError(err instanceof Error ? err.message : String(err), locale);

  useEffect(() => {
    let live = true;
    void window.pi.mcpList().then(
      (items) => {
        if (live) {
          setServers(items);
          setBusy(false);
        }
      },
      (err: unknown) => {
        if (live) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (operation: () => Promise<McpServerInfo[]>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setServers(await operation());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const edit = (server?: McpServerInfo): void => {
    setError(null);
    setArgs(server?.transport.type === "stdio" ? server.transport.args.join("\n") : "");
    setEnv("");
    setHeaders("");
    setDraft(
      server
        ? { ...asInput(server), transport: server.transport, imported: server.imported }
        : {
            id: crypto.randomUUID(),
            name: "",
            enabled: false,
            policy: "inherit",
            transport: { type: "stdio", command: "", args: [] },
            imported: false,
          },
    );
  };

  const save = (): void => {
    if (!draft) return;
    void run(async () => {
      const { imported, ...input } = draft;
      const transport =
        draft.transport.type === "stdio"
          ? {
              ...draft.transport,
              command: draft.transport.command.trim(),
              args: args.split(/\r?\n/).filter(Boolean),
            }
          : { ...draft.transport, url: draft.transport.url.trim() };
      const saved = await window.pi.mcpSave({
        ...input,
        transport:
          imported && !(transport.type === "stdio" ? transport.command : transport.url)
            ? undefined
            : transport,
        env:
          transport.type === "stdio"
            ? readStringPairs(env, "环境变量须为字符串值的 JSON 对象。")
            : undefined,
        headers:
          transport.type === "http"
            ? readStringPairs(headers, "请求头须为字符串值的 JSON 对象。")
            : undefined,
      });
      setDraft(null);
      setEnv("");
      setHeaders("");
      return saved;
    });
  };

  const valid =
    draft &&
    draft.name.trim() &&
    (draft.imported ||
      (draft.transport.type === "stdio"
        ? draft.transport.command.trim()
        : draft.transport.url.trim()));

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => edit()} disabled={busy}>
          <PlusIcon data-icon="inline-start" />
          {t("添加 MCP 服务", locale)}
        </Button>
        <ExternalImportDialog
          kind="mcp"
          label="从 Codex 或 Claude Code 导入"
          locale={locale}
          workingDirectory={workingDirectory}
          disabled={busy}
          onImported={(result) => {
            setReport(result);
            void run(() => window.pi.mcpList());
          }}
        />
      </div>
      <ExternalImportResult report={report} locale={locale} />
      <div className="settings-list" aria-busy={busy}>
        {servers.length === 0 && (busy || !error) && (
          <p role="status" className="text-muted-foreground py-4 text-sm">
            {t(busy ? "正在读取 MCP 状态…" : "还没有 MCP 服务", locale)}
          </p>
        )}
        {servers.map((server) => (
          <section key={server.id} className="settings-row flex-nowrap items-start gap-x-3">
            <div className="min-w-0 flex-1">
              <h2 className="wrap-anywhere text-sm font-medium">{server.name}</h2>
              <p className="text-muted-foreground truncate text-xs leading-5">
                {server.transport.type === "stdio"
                  ? server.transport.command || "stdio"
                  : server.transport.url || "Streamable HTTP"}
              </p>
              {server.status === "connected" &&
                (server.tools.length > 0 ? (
                  <details className="mt-0.5 text-xs">
                    <summary className="cursor-pointer text-emerald-600 dark:text-emerald-400">
                      {t("已连接，{0} 个工具", locale, [server.tools.length])}
                    </summary>
                    <ul className="text-muted-foreground mt-1 grid gap-0.5 pl-3">
                      {server.tools.map((tool) => (
                        <li key={tool.name} className="wrap-anywhere">
                          {tool.label}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    {t("已连接，{0} 个工具", locale, [0])}
                  </p>
                ))}
              {server.error && (
                <p className="text-destructive wrap-anywhere text-xs">{t(server.error, locale)}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                aria-label={t("启用 {0}", locale, [server.name])}
                checked={server.enabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void run(() => window.pi.mcpSave({ ...asInput(server), enabled }))
                }
              />
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={busy}
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("{0} 的操作", locale, [server.name])}
                    />
                  }
                >
                  <EllipsisIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => edit(server)}>
                      {t("编辑", locale)}
                    </DropdownMenuItem>
                    {server.enabled && (
                      <DropdownMenuItem
                        onClick={() => void run(() => window.pi.mcpReconnect(server.id))}
                      >
                        {t("重新连接", locale)}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setRemove(server)}>
                      {t("删除", locale)}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </section>
        ))}
      </div>
      {error && !draft && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDraft(null);
            setEnv("");
          }
        }}
      >
        <DialogContent
          closeLabel={t("关闭", locale)}
          className="max-h-[80vh] max-w-sm overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{t("配置 MCP 服务", locale)}</DialogTitle>
            <DialogDescription>
              {t(
                draft?.imported
                  ? "留空保留导入的连接信息。"
                  : "添加本地程序或 Streamable HTTP 地址。",
                locale,
              )}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs">
                {t("名称", locale)}
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <Select
                value={draft.transport.type}
                onValueChange={(type: "stdio" | "http" | null) => {
                  if (type && type !== draft.transport.type) {
                    setArgs("");
                    setEnv("");
                    setHeaders("");
                    setDraft({
                      ...draft,
                      imported: false,
                      transport:
                        type === "stdio" ? { type, command: "", args: [] } : { type, url: "" },
                    });
                  }
                }}
              >
                <SelectTrigger aria-label={t("传输方式", locale)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="stdio">stdio</SelectItem>
                    <SelectItem value="http">Streamable HTTP</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {draft.transport.type === "stdio" ? (
                <>
                  <label className="grid gap-1 text-xs">
                    {t("启动命令", locale)}
                    <Input
                      value={draft.transport.command}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          transport: { type: "stdio", command: event.target.value, args: [] },
                        })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    {t("参数（每行一个）", locale)}
                    <Textarea
                      value={args}
                      rows={2}
                      onChange={(event) => setArgs(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    {t("环境变量（JSON）", locale)}
                    <Textarea
                      value={env}
                      rows={2}
                      onChange={(event) => setEnv(event.target.value)}
                    />
                    <span className="text-muted-foreground">
                      {t("保留同一命令的变量可留空，输入 {} 可清空。", locale)}
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label className="grid gap-1 text-xs">
                    URL
                    <Input
                      value={draft.transport.url}
                      onChange={(event) =>
                        setDraft({ ...draft, transport: { type: "http", url: event.target.value } })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-xs">
                    {t("请求头（JSON）", locale)}
                    <Textarea
                      value={headers}
                      rows={2}
                      onChange={(event) => setHeaders(event.target.value)}
                    />
                    <span className="text-muted-foreground">
                      {t("留空保留同一连接的请求头，输入 {} 可清空。", locale)}
                    </span>
                  </label>
                </>
              )}
              <Select
                value={draft.policy}
                onValueChange={(policy: McpServerInput["policy"] | null) => {
                  if (policy) setDraft({ ...draft, policy });
                }}
              >
                <SelectTrigger aria-label={t("权限策略", locale)}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="inherit">{t("跟随当前权限模式", locale)}</SelectItem>
                    <SelectItem value="confirm">{t("使用确认模式和授权规则", locale)}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          )}
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setEnv("");
              }}
            >
              {t("取消", locale)}
            </Button>
            <Button disabled={busy || !valid} onClick={save}>
              {t("保存", locale)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <DialogContent closeLabel={t("关闭", locale)} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("删除 MCP 服务", locale)}</DialogTitle>
            <DialogDescription>{remove?.name}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemove(null)}>
              {t("取消", locale)}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (remove) void run(() => window.pi.mcpRemove(remove.id));
                setRemove(null);
              }}
            >
              {t("删除", locale)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
