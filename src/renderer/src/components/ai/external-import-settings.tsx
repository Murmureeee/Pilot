// @env browser
import { useEffect, useRef, useState, type JSX } from "react";

import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import { ListEmpty } from "@renderer/components/ai/list-empty";
import { PluginPackageDialog } from "@renderer/components/ai/plugin-package-dialog";
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
import { EXTERNAL_IMPORT_OPTIONS, IMPORT_SOURCE_LABELS } from "@renderer/lib/constants";
import { localizeError, t } from "@renderer/lib/i18n";
import { importSummary } from "@renderer/lib/import-summary";
import type { Locale } from "@shared/contract";
import type { ExternalImportKind, ImportedPluginInfo, ImportReport } from "@shared/imports";

export function ExternalImportSettings({
  locale,
  workingDirectory,
}: {
  locale: Locale;
  workingDirectory: string | null;
}): JSX.Element {
  const [plugins, setPlugins] = useState<ImportedPluginInfo[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState<ImportedPluginInfo>();
  const [removeError, setRemoveError] = useState("");
  const removalButton = useRef<HTMLButtonElement>(null);
  const installedHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let live = true;
    void window.pi.importedPlugins().then(
      (items) => {
        if (live) {
          setPlugins(items);
          setBusy(false);
        }
      },
      (reason: unknown) => {
        if (live) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setBusy(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setError(null);
    setNotice("");
    setBusy(true);
    try {
      setPlugins(await window.pi.toggleImportedPlugin(id, enabled));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const imported = (result: ImportReport): void => {
    setReport(result);
    setPlugins(result.installedPlugins);
  };

  const remove = async (): Promise<void> => {
    if (!removing || busy) return;
    setBusy(true);
    setRemoveError("");
    try {
      setPlugins(await window.pi.uninstallPlugin(removing.id));
      setRemoving(undefined);
      setNotice("插件已卸载。");
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-9">
      <div className="grid gap-3">
        <div className="settings-list">
          <div className="settings-row">
            <div className="min-w-0 flex-1 basis-48">
              <h2 className="text-sm font-medium">{t("从来源安装", locale)}</h2>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {t("支持 Git 地址、文件夹和 ZIP 压缩包。", locale)}
              </p>
            </div>
            <PluginPackageDialog
              locale={locale}
              disabled={busy}
              onInstalled={(items, updated) => {
                setPlugins(items);
                setNotice(
                  updated ? "插件已更新，当前处于停用状态。" : "插件已安装，当前处于停用状态。",
                );
              }}
            />
          </div>
        </div>
        <h2 className="text-sm font-medium">{t("从 Codex 或 Claude Code 导入", locale)}</h2>
        <div className="settings-list">
          {(Object.keys(EXTERNAL_IMPORT_OPTIONS) as ExternalImportKind[]).map((kind) => {
            const option = EXTERNAL_IMPORT_OPTIONS[kind];
            return (
              <div key={kind} className="settings-row">
                <div className="min-w-0 flex-1 basis-48">
                  <h2 className="text-sm font-medium">{t(option.label, locale)}</h2>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {t(option.description, locale)}
                  </p>
                </div>
                <ExternalImportDialog
                  kind={kind}
                  locale={locale}
                  workingDirectory={workingDirectory}
                  onImported={imported}
                  disabled={busy}
                />
              </div>
            );
          })}
        </div>
        <ExternalImportResult report={report} locale={locale} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      {notice && <output className="text-xs text-muted-foreground">{t(notice, locale)}</output>}
      <section className="grid min-w-0 gap-3" aria-busy={busy} aria-labelledby="installed-plugins">
        <h2
          id="installed-plugins"
          ref={installedHeading}
          tabIndex={-1}
          className="text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("已安装的插件", locale)}
        </h2>
        {!busy && !error && !plugins.length && (
          <ListEmpty
            title={t("还没有已安装的插件。", locale)}
            description={t("已安装和导入的插件会显示在这里。", locale)}
          />
        )}
        <div className="settings-list">
          {plugins.map((plugin) => (
            <div key={plugin.id} className="settings-row" data-installed-plugin={plugin.id}>
              <div className="min-w-0 flex-1 basis-44">
                <p className="text-sm font-medium wrap-anywhere">{plugin.name}</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  {t(IMPORT_SOURCE_LABELS[plugin.source], locale)}
                  {" · " +
                    t("版本 {0}", locale, [
                      plugin.version ?? plugin.revision?.slice(0, 12) ?? t("未声明版本", locale),
                    ])}
                  {" · " +
                    t(
                      plugin.enabled === "none"
                        ? "已停用"
                        : plugin.enabled === "all"
                          ? "已启用"
                          : "部分启用",
                      locale,
                    )}
                </p>
                {plugin.packageSource && (
                  <p className="text-xs wrap-anywhere text-muted-foreground">
                    {plugin.packageSource.location}
                    {plugin.packageSource.kind === "git" && plugin.packageSource.path && (
                      <>
                        <br />
                        {plugin.packageSource.path}
                      </>
                    )}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{importSummary(plugin, locale)}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {plugin.packageSource && (
                  <PluginPackageDialog
                    locale={locale}
                    pluginId={plugin.id}
                    disabled={busy}
                    onInstalled={(items) => {
                      setPlugins(items);
                      setNotice("插件已更新，当前处于停用状态。");
                    }}
                  />
                )}
                {plugin.enabled !== "none" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void toggle(plugin.id, false)}
                  >
                    {t(plugin.enabled === "some" ? "全部停用" : "停用组件", locale)}
                  </Button>
                )}
                {plugin.enabled !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void toggle(plugin.id, true)}
                  >
                    {t(plugin.enabled === "some" ? "全部启用" : "启用组件", locale)}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={busy}
                  onClick={(event) => {
                    removalButton.current = event.currentTarget;
                    setRemoveError("");
                    setRemoving(plugin);
                  }}
                >
                  {t("卸载", locale)}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <Dialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(undefined);
        }}
      >
        <DialogContent
          closeLabel={t("关闭", locale)}
          showCloseButton={!busy}
          finalFocus={() =>
            removalButton.current?.isConnected ? removalButton.current : installedHeading.current
          }
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{t("卸载插件", locale)}</DialogTitle>
            <DialogDescription>
              {t("将删除 Pilot 中「{0}」的安装文件和插件配置。", locale, [removing?.name ?? ""])}
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(removeError, locale)}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" disabled={busy} />}>
              {t("取消", locale)}
            </DialogClose>
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void remove()}>
              {t(busy ? "正在卸载…" : "确认卸载", locale)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
