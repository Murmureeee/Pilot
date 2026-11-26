// @env browser
import { CompassIcon, EllipsisIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import { ListEmpty } from "@renderer/components/ai/list-empty";
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
import { McpRegistryDiscovery } from "@renderer/views/settings/McpRegistryDiscovery";
import type { Locale } from "@shared/contract";
import type { McpRegistryConnection, McpRegistryEntry } from "@shared/discovery";
import type { ImportReport } from "@shared/imports";
import type { McpServerInfo, McpServerInput, McpTransportConfig } from "@shared/mcp";

import { isMcpOAuthCallbackUrl } from "../../../../shared/mcp";
import { McpOAuthControl } from "./mcp-oauth-control";
import { ProjectConfigSettingsSection } from "./project-config-details";

type McpDraft = McpServerInput & { transport: McpTransportConfig; imported: boolean };
type RegistryDraft = { type: McpTransportConfig["type"]; required: string[] };

const unresolvedRegistryField = /\{[-\w.]+\}/;

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
  composerId,
  locale,
  workingDirectory,
}: {
  composerId: string | null;
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
  const [discovering, setDiscovering] = useState(false);
  const [registry, setRegistry] = useState<RegistryDraft>();
  const [registrySaved, setRegistrySaved] = useState(false);
  const discoveryButton = useRef<HTMLButtonElement>(null);
  const registryTrigger = useRef<HTMLButtonElement>(null);

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
    setRegistry(undefined);
    registryTrigger.current = null;
    setArgs(server?.transport.type === "stdio" ? server.transport.args.join("\n") : "");
    setEnv("");
    setHeaders("");
    setDraft(
      server
        ? {
            ...asInput(server),
            transport: server.transport,
            imported: server.imported,
            oauthClient: server.oauthClient,
          }
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

  const useRegistryConnection = (
    entry: McpRegistryEntry,
    connection: McpRegistryConnection,
    trigger: HTMLButtonElement,
  ): void => {
    const { transport, values, required } = connection;
    const defaults = values.length ? JSON.stringify(Object.fromEntries(values), null, 2) : "";
    registryTrigger.current = trigger;
    setError(null);
    setRegistrySaved(false);
    setRegistry({ type: transport.type, required });
    setArgs(transport.type === "stdio" ? transport.args.join("\n") : "");
    setEnv(transport.type === "stdio" ? defaults : "");
    setHeaders(transport.type === "http" ? defaults : "");
    setDraft({
      id: crypto.randomUUID(),
      name: entry.name,
      enabled: false,
      policy: "confirm",
      transport,
      imported: false,
    });
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
      const variables =
        transport.type === "stdio"
          ? readStringPairs(env, "环境变量须为字符串值的 JSON 对象。")
          : undefined;
      const requestHeaders =
        transport.type === "http"
          ? readStringPairs(headers, "请求头须为字符串值的 JSON 对象。")
          : undefined;
      const oauthClient = input.oauthClient;
      const clientId = oauthClient?.clientId.trim();
      const callbackUrl = oauthClient?.callbackUrl?.trim() || undefined;
      const scope = oauthClient?.scope?.trim() || undefined;
      if (transport.type === "http" && !clientId && (callbackUrl || scope))
        throw new Error(t("设置回调地址或授权范围时，请填写 OAuth 客户端 ID。", locale));
      if (transport.type === "http" && callbackUrl && !isMcpOAuthCallbackUrl(callbackUrl))
        throw new Error(
          t("OAuth 回调地址须使用本机 HTTP 地址，例如 http://127.0.0.1:8080/callback。", locale),
        );
      const catalogValues = variables ?? requestHeaders ?? [];
      if (registry?.type === transport.type) {
        const missing = registry.required.filter(
          (key) => !catalogValues.some(([name, value]) => name === key && value.trim()),
        );
        if (missing.length)
          throw new Error(t("请填写必填字段 {0}。", locale, [missing.join(", ")]));
        const address =
          transport.type === "http" ? [transport.url] : [transport.command, ...transport.args];
        if (
          [...address, ...catalogValues.map(([, value]) => value)].some((value) =>
            unresolvedRegistryField.test(value),
          )
        )
          throw new Error(t("请先替换连接配置中的占位符。", locale));
      }
      const saved = await window.pi.mcpSave({
        ...input,
        transport:
          imported && !(transport.type === "stdio" ? transport.command : transport.url)
            ? undefined
            : transport,
        env: registry ? variables?.filter(([, value]) => value !== "") : variables,
        headers: registry ? requestHeaders?.filter(([, value]) => value !== "") : requestHeaders,
        oauthClient:
          transport.type === "http" && clientId
            ? {
                clientId,
                callbackUrl,
                scope,
              }
            : null,
      });
      if (registry) setRegistrySaved(true);
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
      {discovering ? (
        <>
          <McpRegistryDiscovery
            locale={locale}
            saved={registrySaved}
            onSelect={useRegistryConnection}
            onBack={() => {
              setDiscovering(false);
              setRegistrySaved(false);
              setError(null);
              requestAnimationFrame(() => discoveryButton.current?.focus());
            }}
          />
        </>
      ) : (
        <>
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
            <Button
              ref={discoveryButton}
              variant="outline"
              size="sm"
              onClick={() => setDiscovering(true)}
            >
              <CompassIcon data-icon="inline-start" /> {t("发现 MCP 服务", locale)}
            </Button>
          </div>
          <ExternalImportResult report={report} locale={locale} />
          <div className="settings-list" aria-busy={busy}>
            {servers.length === 0 && busy && (
              <p role="status" className="py-4 text-sm text-muted-foreground">
                {t("正在读取 MCP 状态…", locale)}
              </p>
            )}
            {servers.length === 0 && !busy && !error && (
              <ListEmpty
                title={t("还没有 MCP 服务", locale)}
                description={t("添加服务后，这里会显示连接状态和它提供的工具。", locale)}
              />
            )}
            {servers.map((server) => (
              <section key={server.id} className="settings-row flex-nowrap items-start gap-x-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium wrap-anywhere">{server.name}</h2>
                  <p className="truncate text-xs leading-5 text-muted-foreground">
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
                        <ul className="mt-1 grid gap-0.5 pl-3 text-muted-foreground">
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
                  {server.error && server.oauth?.status !== "required" && (
                    <p className="text-xs wrap-anywhere text-destructive">
                      {t(server.error, locale)}
                    </p>
                  )}
                  {server.oauth && (
                    <McpOAuthControl
                      key={server.oauth.revision}
                      info={server.oauth}
                      name={server.name}
                      onChanged={() => void run(() => window.pi.mcpList())}
                    />
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
          {composerId && <ProjectConfigSettingsSection composerId={composerId} section="mcp" />}
          {error && !draft && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </>
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
          finalFocus={registryTrigger.current ? () => registryTrigger.current : undefined}
        >
          <DialogHeader>
            <DialogTitle>{t("配置 MCP 服务", locale)}</DialogTitle>
            <DialogDescription>
              {t(
                registry
                  ? "核对地址或启动命令，填写必填字段并替换占位符。保存后默认停用。"
                  : draft?.imported
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
                    setRegistry(undefined);
                    setDraft({
                      ...draft,
                      imported: false,
                      oauthClient: null,
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
                  <details className="text-xs">
                    <summary className="cursor-pointer">
                      {t("OAuth 客户端（可选）", locale)}
                    </summary>
                    <div className="mt-2 grid gap-2">
                      <p className="text-muted-foreground">
                        {t("默认自动注册。如果服务提供了公共客户端 ID，可在这里填写。", locale)}
                      </p>
                      <label className="grid gap-1">
                        {t("OAuth 客户端 ID", locale)}
                        <Input
                          value={draft.oauthClient?.clientId ?? ""}
                          maxLength={2048}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              oauthClient: { ...draft.oauthClient, clientId: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        {t("OAuth 回调地址", locale)}
                        <Input
                          value={draft.oauthClient?.callbackUrl ?? ""}
                          maxLength={2048}
                          placeholder="http://127.0.0.1:8080/callback"
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              oauthClient: {
                                clientId: "",
                                ...draft.oauthClient,
                                callbackUrl: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                      <label className="grid gap-1">
                        {t("OAuth 授权范围", locale)}
                        <Input
                          value={draft.oauthClient?.scope ?? ""}
                          maxLength={2048}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              oauthClient: {
                                clientId: "",
                                ...draft.oauthClient,
                                scope: event.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                  </details>
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
            <p role="alert" className="text-xs text-destructive">
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
