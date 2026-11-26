// @env browser
import { useId, useLayoutEffect, useRef, useState, type JSX, type Ref } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { IMPORT_SOURCE_LABELS } from "@renderer/lib/constants";
import { localizeError, t } from "@renderer/lib/i18n";
import type { Locale } from "@shared/contract";
import type {
  ImportedPluginInfo,
  PluginPackagePreview,
  PluginPackageSource,
} from "@shared/imports";

function Inventory({
  preview,
  locale,
  heading,
}: {
  preview: PluginPackagePreview;
  locale: Locale;
  heading: Ref<HTMLHeadingElement>;
}): JSX.Element {
  const groups = [
    { title: "技能", items: preview.skills },
    { title: "脚本文件", items: preview.scripts },
    { title: "暂不支持", items: preview.unsupported },
  ];
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-1">
        <h3
          ref={heading}
          tabIndex={-1}
          className="font-medium wrap-anywhere focus-visible:ring-2 focus-visible:ring-ring"
        >
          {preview.name}
        </h3>
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {t(IMPORT_SOURCE_LABELS[preview.format], locale)}
        </p>
        <p className="text-xs wrap-anywhere text-muted-foreground">{preview.source.location}</p>
        {preview.source.kind === "git" && preview.source.path && (
          <p className="text-xs wrap-anywhere text-muted-foreground">{preview.source.path}</p>
        )}
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {t("版本 {0}", locale, [preview.version ?? t("未声明版本", locale)])}
          {preview.revision && " · " + preview.revision.slice(0, 12)}
        </p>
      </div>
      {preview.previous && (
        <section className="grid min-w-0 gap-1">
          <h3 className="font-medium">{t("更新差异", locale)}</h3>
          <p className="text-xs text-muted-foreground">
            {t("当前版本 {0}", locale, [
              preview.previous.version ??
                preview.previous.revision?.slice(0, 12) ??
                t("未声明版本", locale),
            ])}
          </p>
          {preview.previous.changes.map(({ path, kind, before, after }) => {
            const label = { added: "新增文件", modified: "已修改文件", removed: "移除文件" }[kind];
            const heading = (
              <>
                {t(label, locale)} <code className="wrap-anywhere">{path}</code>
              </>
            );
            return before !== undefined || after !== undefined ? (
              <details key={path} className="min-w-0">
                <summary className="cursor-pointer text-xs focus-visible:ring-2 focus-visible:ring-ring">
                  {heading}
                </summary>
                {before !== undefined && (
                  <div className="mt-1">
                    <p className="text-xs text-muted-foreground">{t("旧版节选", locale)}</p>
                    <pre className="max-h-24 overflow-auto rounded-md bg-muted p-2 text-xs wrap-anywhere whitespace-pre-wrap">
                      {before}
                    </pre>
                  </div>
                )}
                {after !== undefined && (
                  <div className="mt-1">
                    <p className="text-xs text-muted-foreground">{t("新版节选", locale)}</p>
                    <pre className="max-h-24 overflow-auto rounded-md bg-muted p-2 text-xs wrap-anywhere whitespace-pre-wrap">
                      {after}
                    </pre>
                  </div>
                )}
              </details>
            ) : (
              <p key={path} className="text-xs">
                {heading}
              </p>
            );
          })}
          {preview.current && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("当前已是最新版本。", locale)}
            </p>
          )}
        </section>
      )}
      {groups
        .filter(({ items }) => items.length > 0)
        .map(({ title, items }) => (
          <section key={title} className="grid min-w-0 gap-1">
            <h3 className="font-medium">{t(title, locale)}</h3>
            <ul className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              {items.map((item, index) => (
                <li key={item + index} className="wrap-anywhere">
                  {title === "暂不支持" ? t(item, locale) : item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      {preview.templates.length > 0 && (
        <section className="grid min-w-0 gap-1">
          <h3 className="font-medium">{t("提示词模板", locale)}</h3>
          {preview.templates.map(({ name, text, path }) => (
            <details key={name} className="min-w-0">
              <summary className="cursor-pointer text-xs wrap-anywhere focus-visible:ring-2 focus-visible:ring-ring">
                {"/prompt-" + name}
              </summary>
              <p className="text-xs wrap-anywhere text-muted-foreground">{path}</p>
              <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs wrap-anywhere whitespace-pre-wrap">
                {text}
              </pre>
            </details>
          ))}
        </section>
      )}
      {preview.servers.length > 0 && (
        <section className="grid min-w-0 gap-1">
          <h3 className="font-medium">{t("MCP 连接与启动命令", locale)}</h3>
          {preview.servers.map(({ name, command, args }) => (
            <div key={name} className="grid min-w-0 gap-0.5">
              <p className="text-xs wrap-anywhere">{name}</p>
              <code className="rounded-md bg-muted p-2 text-xs wrap-anywhere">
                {[command, ...args.map((arg) => JSON.stringify(arg))].join(" ")}
              </code>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

export function PluginPackageDialog({
  locale,
  pluginId,
  source,
  disabled,
  onInstalled,
}: {
  locale: Locale;
  pluginId?: string;
  source?: PluginPackageSource;
  disabled: boolean;
  onInstalled(items: ImportedPluginInfo[], updated: boolean): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [git, setGit] = useState("");
  const [preview, setPreview] = useState<PluginPackagePreview>();
  const [busy, setBusy] = useState<"preview" | "apply">();
  const [error, setError] = useState("");
  const fieldId = useId();
  const gitField = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const request = useRef(0);
  const reportError = (reason: unknown): void =>
    setError(reason instanceof Error ? reason.message : String(reason));

  useLayoutEffect(() => {
    // Move focus before the dialog handles the removal of the focused source input.
    if (open && preview) previewHeading.current?.focus();
  }, [open, preview]);

  const load = async (source: PluginPackageSource | string): Promise<void> => {
    const ticket = ++request.current;
    setPreview(undefined);
    setBusy("preview");
    setError("");
    try {
      const result = await window.pi.previewPluginPackage(source);
      if (request.current === ticket) setPreview(result);
    } catch (reason) {
      if (request.current === ticket) reportError(reason);
    } finally {
      if (request.current === ticket) setBusy(undefined);
    }
  };

  const pick = async (kind: "directory" | "zip"): Promise<void> => {
    const ticket = ++request.current;
    setBusy("preview");
    setError("");
    try {
      const location = await window.pi.pickPluginPackage(kind, locale);
      if (location && request.current === ticket) await load({ kind, location });
    } catch (reason) {
      if (request.current === ticket) reportError(reason);
    } finally {
      if (request.current === ticket) setBusy(undefined);
    }
  };

  const apply = async (): Promise<void> => {
    if (!preview || busy) return;
    setBusy("apply");
    setError("");
    try {
      const result = await window.pi.installPluginPackage(
        pluginId ?? preview.source,
        preview.token,
      );
      onInstalled(result, Boolean(preview.previous));
      setOpen(false);
    } catch (reason) {
      reportError(reason);
    } finally {
      setBusy(undefined);
    }
  };

  const empty =
    preview && !preview.skills.length && !preview.templates.length && !preview.servers.length;
  const suppliedSource = pluginId ?? source;
  const retrySource = suppliedSource ?? preview?.source;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy === "apply") return;
        request.current++;
        setOpen(next);
        setPreview(undefined);
        setBusy(undefined);
        setError("");
        if (next && suppliedSource) void load(suppliedSource);
      }}
    >
      <DialogTrigger
        render={<Button size="sm" variant={pluginId ? "ghost" : "outline"} disabled={disabled} />}
      >
        {t(pluginId ? "检查更新" : source ? "预览安装" : "安装插件…", locale)}
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 p-4 sm:max-w-xl"
        closeLabel={t("关闭", locale)}
        initialFocus={suppliedSource ? undefined : gitField}
        showCloseButton={busy !== "apply"}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t(pluginId ? "检查插件更新" : "安装插件", locale)}</DialogTitle>
          <DialogDescription>
            {t("核对要安装的组件和 MCP 命令。安装或更新后，插件处于停用状态。", locale)}
          </DialogDescription>
        </DialogHeader>
        <div data-plugin-review className="min-h-0 min-w-0 [scrollbar-width:thin] overflow-y-auto">
          {!suppliedSource && !preview && (
            <div className="grid gap-3">
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!busy && git.trim()) void load({ kind: "git", location: git.trim() });
                }}
              >
                <label htmlFor={fieldId} className="text-sm font-medium">
                  {t("Git 地址", locale)}
                </label>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <Input
                    ref={gitField}
                    id={fieldId}
                    className="min-w-0 flex-1 basis-32"
                    value={git}
                    onChange={(event) => setGit(event.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={Boolean(busy) || !git.trim()}
                  >
                    {t("预览插件", locale)}
                  </Button>
                </div>
              </form>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => void pick("directory")}
                >
                  {t("选择插件文件夹…", locale)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => void pick("zip")}
                >
                  {t("选择 ZIP 压缩包…", locale)}
                </Button>
              </div>
            </div>
          )}
          {busy === "preview" && (
            <p className="py-2 text-xs text-muted-foreground" role="status">
              {t("正在读取插件…", locale)}
            </p>
          )}
          {preview && <Inventory preview={preview} locale={locale} heading={previewHeading} />}
          {empty && (
            <p className="py-2 text-xs text-muted-foreground">
              {t("没有可安装的插件组件。请检查所选来源。", locale)}
            </p>
          )}
        </div>
        <DialogFooter className="grid gap-2">
          {error && (
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <DialogClose
              render={<Button variant="outline" size="sm" disabled={busy === "apply"} />}
            >
              {t("关闭", locale)}
            </DialogClose>
            {error && retrySource && (
              <Button variant="outline" size="sm" onClick={() => void load(retrySource)}>
                {t("重新预览", locale)}
              </Button>
            )}
            {preview && !preview.current && !empty && (
              <Button size="sm" disabled={Boolean(busy)} onClick={() => void apply()}>
                {t(
                  busy === "apply" ? "正在安装…" : preview.previous ? "安装更新" : "确认安装",
                  locale,
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
