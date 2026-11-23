// @env browser
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { Checkbox } from "@base-ui/react/checkbox";
import { CheckIcon, FolderOpenIcon, MinusIcon, RotateCwIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { localizeError, t } from "@renderer/lib/i18n";
import { EXTERNAL_IMPORT_OPTIONS, IMPORT_SOURCE_LABELS } from "@renderer/lib/constants";
import { importSummary } from "@renderer/lib/import-summary";
import { APP_NAME } from "@shared/constants";
import type { Locale } from "@shared/contract";
import type {
  ExternalImportItem,
  ExternalImportKind,
  ExternalImportPreview,
  ImportIssue,
  ImportReport,
} from "@shared/imports";

const REASONS: Record<ImportIssue["reason"], string> = {
  read: "找不到或无法读取来源文件。",
  copy: "无法复制本地文件。",
  transport: "此 MCP 传输方式暂未支持。",
  connection: "MCP 连接配置无效。",
  native: "此项包含依赖原应用的组件。",
  encryption: "系统密钥服务不可用，无法保存 MCP 连接。",
};

function SelectionRow({
  label,
  children,
  checked,
  mixed = false,
  disabled,
  onChange,
}: {
  label: string;
  children: ReactNode;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <Checkbox.Root
      aria-label={label}
      checked={checked}
      indeterminate={mixed}
      disabled={disabled}
      onCheckedChange={onChange}
      className="group flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring data-disabled:cursor-default data-disabled:text-muted-foreground data-disabled:hover:bg-transparent"
    >
      <span className="border-muted-foreground/50 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border group-data-checked:border-primary group-data-checked:bg-primary group-data-checked:text-primary-foreground group-data-indeterminate:border-primary group-data-indeterminate:bg-primary group-data-indeterminate:text-primary-foreground group-data-disabled:opacity-50">
        <Checkbox.Indicator>
          {mixed ? <MinusIcon className="size-3" /> : <CheckIcon className="size-3" />}
        </Checkbox.Indicator>
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </Checkbox.Root>
  );
}

function itemDetail(item: ExternalImportItem, locale: Locale): string | undefined {
  if (item.contents) {
    return importSummary(
      { skills: item.contents.skills.length, servers: item.contents.servers.length },
      locale,
    );
  }
  if (item.plugin) return t("来自插件 {0}", locale, [item.plugin]);
  if (item.transport) return item.transport === "http" ? "Streamable HTTP" : "stdio";
  return item.description;
}

function ImportIssues({
  issues,
  locale,
}: {
  issues: ImportIssue[];
  locale: Locale;
}): JSX.Element | null {
  if (!issues.length) return null;
  return (
    <details className="text-muted-foreground text-xs">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
        {t("{0} 项需要查看", locale, [issues.length])}
      </summary>
      <ul className="mt-2 grid gap-2">
        {issues.map(({ name, reason }, index) => (
          <li key={`${name}:${reason}:${index}`} className="grid gap-0.5">
            <span className="text-foreground wrap-break-word">{name}</span>
            <span>{t(REASONS[reason], locale)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ExternalImportResult({
  report,
  locale,
}: {
  report: ImportReport | null;
  locale: Locale;
}): JSX.Element | null {
  if (!report) return null;
  const summary = importSummary(report, locale);
  return (
    <div className="text-muted-foreground grid gap-1.5 text-xs">
      <p role="status">
        {summary ? t("已导入 {0}。", locale, [summary]) : t("本次没有新增项目。", locale)}
        {(report.skills > 0 || report.servers > 0) && t(" 新增的技能和 MCP 服务默认停用。", locale)}
        {report.existing > 0 && t("跳过 {0} 个已导入项目。", locale, [report.existing])}
      </p>
      <ImportIssues issues={report.issues} locale={locale} />
    </div>
  );
}

export function ExternalImportDialog({
  kind,
  label = "选择…",
  locale,
  workingDirectory,
  onImported,
  disabled,
}: {
  kind: ExternalImportKind;
  label?: string;
  locale: Locale;
  workingDirectory: string | null;
  onImported(report: ImportReport): void;
  disabled?: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState(workingDirectory);
  const [scanNumber, setScanNumber] = useState(0);
  const [preview, setPreview] = useState<ExternalImportPreview | null>(null);
  const [selected, setSelected] = useState(() => new Set<string>());
  const [saving, setSaving] = useState(false);
  const [choosingProject, setChoosingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rescan = (nextProject: string | null): void => {
    setProject(nextProject);
    setScanNumber((previous) => previous + 1);
    setPreview(null);
    setSelected(new Set());
    setError(null);
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    void window.pi.previewExternalImport(kind, project).then(
      (result) => {
        if (live) setPreview(result);
      },
      (reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      live = false;
    };
  }, [open, kind, project, scanNumber]);

  const chooseProject = async (): Promise<void> => {
    setChoosingProject(true);
    try {
      const directory = await window.pi.pickImportDirectory(locale);
      if (directory) rescan(directory);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setChoosingProject(false);
    }
  };

  const updateSelected = (ids: string[], checked: boolean): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const confirm = async (): Promise<void> => {
    if (!selected.size || saving || choosingProject || !preview) return;
    setSaving(true);
    setError(null);
    try {
      const report = await window.pi.importExternal(kind, project, [...selected]);
      onImported(report);
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const groups = preview?.groups ?? [];
  const available = groups.flatMap(({ items }) => items.filter((item) => !item.imported));
  const chosenCount = available.filter(({ id }) => selected.has(id)).length;
  const scanning = preview === null && error === null;
  const locked = choosingProject || saving;
  const hasItems = groups.some(({ items }) => items.length > 0);
  const option = EXTERNAL_IMPORT_OPTIONS[kind];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (locked) return;
        if (next) rescan(workingDirectory);
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={t(option.chooseLabel, locale)}
          />
        }
      >
        {t(label, locale)}
      </DialogTrigger>
      <DialogContent
        closeLabel={t("关闭", locale)}
        showCloseButton={!locked}
        className="max-h-[calc(100dvh-1.5rem)] grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3 p-4 sm:max-w-[38rem] sm:p-5"
      >
        <DialogHeader className="pr-9">
          <DialogTitle>{t(option.title, locale)}</DialogTitle>
          <DialogDescription>
            {t("勾选要导入的项目，确认后添加到 {0}。", locale, [APP_NAME])}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-28 flex-1">
            <p className="text-xs">{t("项目来源", locale)}</p>
            <p className="text-muted-foreground truncate text-xs" title={project ?? undefined}>
              {project ?? t("仅导入用户配置", locale)}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={locked}
            onClick={() => void chooseProject()}
          >
            <FolderOpenIcon data-icon="inline-start" />
            {t("选择项目", locale)}
          </Button>
          {project && (
            <Button size="sm" variant="ghost" disabled={locked} onClick={() => rescan(null)}>
              {t("仅用户配置", locale)}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={locked || scanning}
            aria-label={t("重新扫描", locale)}
            title={t("重新扫描", locale)}
            onClick={() => rescan(project)}
          >
            <RotateCwIcon />
          </Button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain rounded-xl border bg-muted/20 p-2">
          {scanning && (
            <p role="status" className="text-muted-foreground px-2.5 py-4 text-xs">
              {t("正在扫描可导入的项目…", locale)}
            </p>
          )}
          {preview && !hasItems && (
            <p className="text-muted-foreground px-2.5 py-4 text-sm">
              {t("没有找到可导入的项目。", locale)}
            </p>
          )}
          {hasItems && (
            <SelectionRow
              label={t("全选", locale)}
              checked={available.length > 0 && chosenCount === available.length}
              mixed={chosenCount > 0 && chosenCount < available.length}
              disabled={locked || available.length === 0}
              onChange={(checked) =>
                updateSelected(
                  available.map(({ id }) => id),
                  checked,
                )
              }
            >
              {t("全选", locale)}
            </SelectionRow>
          )}
          {groups.map(({ source, items, issues }) => {
            if (!items.length && !issues.length) return null;
            const ids = items.filter(({ imported }) => !imported).map(({ id }) => id);
            const checked = ids.filter((id) => selected.has(id)).length;
            return (
              <section
                key={source}
                aria-label={IMPORT_SOURCE_LABELS[source]}
                className="mt-1 border-t pt-1"
              >
                <SelectionRow
                  label={t("全选 {0}", locale, [IMPORT_SOURCE_LABELS[source]])}
                  checked={ids.length > 0 && checked === ids.length}
                  mixed={checked > 0 && checked < ids.length}
                  disabled={locked || ids.length === 0}
                  onChange={(value) => updateSelected(ids, value)}
                >
                  <span className="font-medium">{IMPORT_SOURCE_LABELS[source]}</span>
                </SelectionRow>
                <ul className="ml-3 border-l pl-1">
                  {items.map((item) => {
                    const detail = itemDetail(item, locale);
                    return (
                      <li key={item.id}>
                        <SelectionRow
                          label={item.name}
                          checked={selected.has(item.id)}
                          disabled={locked || item.imported}
                          onChange={(value) => updateSelected([item.id], value)}
                        >
                          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                            <span className="min-w-0 wrap-break-word">{item.name}</span>
                            {item.imported && (
                              <span className="text-muted-foreground text-xs">
                                {t("已导入", locale)}
                              </span>
                            )}
                          </span>
                          {detail && (
                            <span
                              className="text-muted-foreground block truncate text-xs"
                              title={detail}
                            >
                              {detail}
                            </span>
                          )}
                        </SelectionRow>
                        {item.contents && (
                          <details className="text-muted-foreground px-9 pb-1 text-xs">
                            <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                              {t("查看包含的项目", locale)}
                            </summary>
                            <ul className="mt-1 grid gap-0.5">
                              {item.contents.skills.map((name, index) => (
                                <li key={`skill-${index}`}>{t("技能 {0}", locale, [name])}</li>
                              ))}
                              {item.contents.servers.map((name, index) => (
                                <li key={`mcp-${index}`}>{t("MCP 服务 {0}", locale, [name])}</li>
                              ))}
                            </ul>
                            {item.contents.partial && (
                              <p className="mt-1">{t("部分组件暂不可导入。", locale)}</p>
                            )}
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {issues.length > 0 && (
                  <div className="px-2.5 py-2">
                    <ImportIssues issues={issues} locale={locale} />
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="grid gap-2">
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {localizeError(error, locale)}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-muted-foreground text-xs">
              {t("已选 {0}/{1} 项", locale, [chosenCount, available.length])}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={locked} onClick={() => setOpen(false)}>
                {t("取消", locale)}
              </Button>
              <Button
                size="sm"
                disabled={locked || chosenCount === 0}
                onClick={() => void confirm()}
              >
                {t(saving ? "正在导入…" : "确认导入", locale)}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
