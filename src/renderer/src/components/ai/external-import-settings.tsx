// @env browser
import { useEffect, useState, type JSX } from "react";

import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import { Button } from "@renderer/components/ui/button";
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

  return (
    <div className="grid gap-9">
      <div className="grid gap-3">
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
      {plugins.length > 0 && (
        <section className="grid min-w-0 gap-3" aria-busy={busy}>
          <h2 className="text-sm font-semibold">{t("已导入的插件组件", locale)}</h2>
          <div className="settings-list">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="settings-row">
                <div className="min-w-0 flex-1 basis-44">
                  <p className="text-sm font-medium wrap-anywhere">{plugin.name}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    {t("来自 {0}，包含 {1}", locale, [
                      IMPORT_SOURCE_LABELS[plugin.source],
                      importSummary(plugin, locale),
                    ])}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
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
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
