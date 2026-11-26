// @env browser
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  PERMISSION_ATTENTION_TEXT,
  TOOL_RULE_LABELS,
  VERIFICATION_LABELS,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { describeToolScope } from "@renderer/lib/tool-rules";
import { selectProjectDirectory, useAgentStore } from "@renderer/stores/agent";
import { VERIFICATION_KINDS } from "@shared/contract";
import type {
  ProjectConfigInfo,
  ProjectConfigIssueReason,
  ProjectConfigSummary,
  ProjectTrustState,
} from "@shared/project-config";

import { PROJECT_CONFIG_FILE } from "../../../../shared/project-config";
import { McpOAuthControl } from "./mcp-oauth-control";

const TRUST_LABELS: Record<ProjectTrustState, string> = {
  "not-needed": "没有需要信任的项目配置",
  trusted: "已信任",
  changed: "配置已更改，待重新确认",
  untrusted: "待确认信任",
};
const ISSUE_LABELS: Record<ProjectConfigIssueReason, string> = {
  unreadable: "无法读取配置文件",
  "too-large": "配置文件超过大小上限",
  "invalid-json": "配置文件不是有效的 JSON 对象",
  "invalid-field": "配置包含无效字段",
  "unsupported-server": "此 MCP 服务配置无效或不受支持",
  "unsupported-rule": "此授权规则无效或不受支持",
};

type ConfigSection = "all" | "mcp" | "permissions";

export function ProjectConfigSource({
  file = PROJECT_CONFIG_FILE,
}: {
  file?: string;
}): JSX.Element {
  const locale = useLocale();
  return (
    <p className="text-xs wrap-anywhere text-muted-foreground" data-project-config-source>
      {t("项目配置来源", locale)} <bdi className="font-mono">{file}</bdi>
    </p>
  );
}

export function ProjectConfigEntries({
  config,
  section = "all",
  mcpActions,
}: {
  config: ProjectConfigSummary;
  section?: ConfigSection;
  mcpActions?(name: string): JSX.Element | undefined;
}): JSX.Element {
  const locale = useLocale();
  const verification = VERIFICATION_KINDS.filter((kind) => config.verification[kind]);
  return (
    <div className="grid min-w-0 gap-3">
      {section !== "permissions" && config.mcpServers.length > 0 && (
        <section className="grid min-w-0 gap-1">
          {section === "all" && <h3 className="text-sm font-medium">{t("MCP 服务", locale)}</h3>}
          <ul className="divide-y divide-border">
            {config.mcpServers.map(({ name, file, transport, cwd, envNames, policy }) => (
              <li key={name} className="grid min-w-0 gap-0.5 py-1.5">
                <p className="text-sm wrap-anywhere">
                  <bdi>{name}</bdi>
                </p>
                <ProjectConfigSource file={file} />
                <code className="text-xs wrap-anywhere break-all whitespace-pre-wrap">
                  {transport.type === "http"
                    ? transport.url
                    : [transport.command, ...transport.args.map((arg) => JSON.stringify(arg))].join(
                        " ",
                      )}
                </code>
                {cwd && (
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {t("工作目录", locale)} <bdi className="font-mono">{cwd}</bdi>
                  </p>
                )}
                {envNames.length > 0 && (
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {t("环境变量与请求头", locale)}{" "}
                    <bdi className="font-mono">{envNames.join(", ")}</bdi>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(policy === "confirm" ? "确认工具调用" : "沿用会话权限", locale)}
                </p>
                {mcpActions?.(name)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {section !== "mcp" && config.toolRules.length > 0 && (
        <section className="grid min-w-0 gap-1">
          {section === "all" && (
            <h3 className="text-sm font-medium">{t("工具授权规则", locale)}</h3>
          )}
          <ul className="divide-y divide-border">
            {config.toolRules.map((rule, index) => (
              <li key={index} className="grid min-w-0 gap-0.5 py-1.5">
                <p className="text-sm wrap-anywhere">
                  {t(TOOL_RULE_LABELS[rule.toolName] ?? rule.toolName, locale)}
                </p>
                <ProjectConfigSource />
                <p className="text-xs wrap-anywhere text-muted-foreground">
                  {describeToolScope(rule, locale)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {section === "all" && verification.length > 0 && (
        <section className="grid gap-1">
          <h3 className="text-sm font-medium">{t("验证命令", locale)}</h3>
          <ProjectConfigSource />
          <ul className="divide-y divide-border">
            {verification.map((kind) => (
              <li key={kind} className="grid min-w-0 gap-0.5 py-1.5">
                <p className="text-xs text-muted-foreground">
                  {t(VERIFICATION_LABELS[kind], locale)}
                  {config.afterTurn?.kind === kind && <> ({t("回合后验证", locale)})</>}
                </p>
                <code className="text-xs wrap-anywhere whitespace-pre-wrap">
                  {config.verification[kind]}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
      {section === "all" && config.issues.length > 0 && (
        <section className="grid gap-1">
          <h3 className="text-sm font-medium text-destructive">
            {t("部分项目配置无法加载", locale)}
          </h3>
          <ul className="grid gap-1">
            {config.issues.map(({ file, reason, name }, index) => (
              <li key={index} className="text-xs wrap-anywhere text-muted-foreground">
                <bdi className="font-mono">
                  {file}
                  {name ? " / " + name : ""}
                </bdi>{" "}
                {t(ISSUE_LABELS[reason], locale)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{t("修正文件后刷新项目配置。", locale)}</p>
        </section>
      )}
    </div>
  );
}

function useProjectConfig(composerId: string | null): {
  config: ProjectConfigInfo | null;
  error?: string;
  refresh: () => void;
} {
  const directory = useAgentStore(selectProjectDirectory);
  const [config, setConfig] = useState<ProjectConfigInfo | null>(null);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const refresh = (): void => setReload((value) => value + 1);
  useEffect(() => {
    if (!composerId || !directory) return;
    let live = true;
    setError(undefined);
    void window.pi.sessionProjectConfig(composerId).then(
      (data) => {
        if (live) setConfig(data);
      },
      (cause: unknown) => {
        if (live) setError(String(cause));
      },
    );
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (
        (event.type === "snapshot" && event.snapshot.composerId === composerId) ||
        (event.type === "project_trust_resolved" && event.run.sessionId === composerId)
      )
        setReload((value) => value + 1);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [composerId, directory, reload]);
  return { config: config?.directory === directory ? config : null, error, refresh };
}

function ProjectConfigDialogBody({
  composerId,
  finalFocus,
}: {
  composerId: string;
  finalFocus: RefObject<HTMLElement | null>;
}): JSX.Element {
  const locale = useLocale();
  const { config, error: loadError, refresh } = useProjectConfig(composerId);
  const waiting = useAgentStore((state) => Boolean(state.pendingProjectTrust));
  const content = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const setTrust = async (revision: string | null): Promise<void> => {
    if (!config || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await window.pi.sessionSetProjectTrust(composerId, config.directory, revision);
      content.current?.focus();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  const needsTrust = config?.trust === "changed" || config?.trust === "untrusted";
  return (
    <DialogContent
      showCloseButton={false}
      initialFocus={content}
      finalFocus={finalFocus}
      className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3"
      data-project-config-dialog
    >
      <DialogHeader>
        <DialogTitle>{t("项目配置", locale)}</DialogTitle>
        <DialogDescription>
          {t("查看此项目声明的 MCP 服务、授权规则和验证命令。", locale)}
        </DialogDescription>
      </DialogHeader>
      <div
        ref={content}
        role="region"
        aria-label={t("项目配置详情", locale)}
        tabIndex={0}
        className="min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-sm px-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {config ? (
          <div className="grid gap-3">
            <div className="grid gap-0.5 text-sm">
              <p className="font-mono wrap-anywhere">{config.directory}</p>
              <p
                className={needsTrust ? PERMISSION_ATTENTION_TEXT : "text-muted-foreground"}
                role="status"
              >
                {t(TRUST_LABELS[config.trust], locale)}
              </p>
              {config.files.length > 0 && (
                <p className="font-mono text-xs wrap-anywhere text-muted-foreground">
                  {config.files.join(", ")}
                </p>
              )}
            </div>
            <ProjectConfigEntries config={config} />
            {needsTrust && (
              <p className="text-xs text-muted-foreground">
                {t(
                  waiting
                    ? "请在输入坞处理当前的信任请求。"
                    : "信任后，服务可在任务中启动，授权规则与验证命令会在此项目中生效。",
                  locale,
                )}
              </p>
            )}
          </div>
        ) : (
          !loadError && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("正在读取项目配置…", locale)}
            </p>
          )
        )}
        {(error || loadError) && (
          <p role="alert" className="text-xs wrap-anywhere text-destructive">
            {t("操作失败，请重试。", locale)} {localizeError(error ?? loadError ?? "", locale)}
          </p>
        )}
      </div>
      <DialogFooter className="flex-row flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setError(undefined);
            refresh();
          }}
        >
          {t("刷新项目配置", locale)}
        </Button>
        {config?.hasSavedTrust && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void setTrust(null)}
          >
            {t("撤销项目配置的信任", locale)}
          </Button>
        )}
        <DialogClose render={<Button type="button" variant="outline" />}>
          {t("关闭", locale)}
        </DialogClose>
        {config && needsTrust && !waiting && (
          <Button
            type="button"
            disabled={pending || Boolean(loadError)}
            onClick={() => void setTrust(config.revision)}
          >
            {t("信任项目配置", locale)}
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

export function ProjectConfigDialog({
  composerId,
  open,
  onOpenChange,
  finalFocus,
}: {
  composerId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  finalFocus: RefObject<HTMLElement | null>;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ProjectConfigDialogBody composerId={composerId} finalFocus={finalFocus} />}
    </Dialog>
  );
}

export function ProjectConfigSettingsSection({
  composerId,
  section,
}: {
  composerId: string;
  section: Exclude<ConfigSection, "all">;
}): JSX.Element | null {
  const locale = useLocale();
  const { config, error, refresh } = useProjectConfig(composerId);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const count = section === "mcp" ? config?.mcpServers.length : config?.toolRules.length;
  if (error)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="text-xs wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
        <Button variant="outline" size="sm" onClick={refresh}>
          {t("刷新项目配置", locale)}
        </Button>
      </div>
    );
  if (!config || !count) return null;
  return (
    <section className="grid min-w-0 gap-2" data-project-config-settings={section}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-sm font-semibold">
            {t(section === "mcp" ? "项目 MCP 服务" : "项目授权规则", locale)}
          </h2>
          <p className="text-xs wrap-anywhere text-muted-foreground">{config.directory}</p>
          <p className="text-xs text-muted-foreground">{t(TRUST_LABELS[config.trust], locale)}</p>
        </div>
        <Button ref={trigger} variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("项目配置…", locale)}
        </Button>
      </div>
      <ProjectConfigEntries
        config={config}
        section={section}
        mcpActions={(name) => {
          if (!Object.hasOwn(config.mcpOAuth ?? {}, name)) return;
          const oauth = config.mcpOAuth?.[name];
          if (oauth)
            return (
              <McpOAuthControl
                key={composerId + oauth.revision}
                info={oauth}
                name={name}
                composerId={composerId}
                onChanged={refresh}
              />
            );
        }}
      />
      <ProjectConfigDialog
        composerId={composerId}
        open={open}
        onOpenChange={setOpen}
        finalFocus={trigger}
      />
    </section>
  );
}
