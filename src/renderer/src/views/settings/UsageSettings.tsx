// @env browser
import { useEffect, useState, type JSX } from "react";

import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { t, useLocale } from "@renderer/lib/i18n";
import { LOCALE_DETAILS } from "@shared/constants";
import type { Snapshot } from "@shared/contract";
import type { UsageReport } from "@shared/usage";

const GROUP_LABELS = { days: "按天", projects: "按项目", models: "按模型" } as const;
const UNKNOWN_LABELS = { days: "未知日期", projects: "未关联项目", models: "未知模型" } as const;

function tokenCount({ input, output, cacheRead, cacheWrite }: Snapshot["usage"]): number {
  return input + output + cacheRead + (cacheWrite ?? 0);
}

export function UsageSettings(): JSX.Element {
  const locale = useLocale();
  const [group, setGroup] = useState<keyof typeof GROUP_LABELS>("days");
  const [report, setReport] = useState<UsageReport>();
  const [error, setError] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [request, setRequest] = useState(0);
  const [completed, setCompleted] = useState(-1);

  useEffect(() => {
    let closed = false;
    const delay = window.setTimeout(() => setShowLoading(true), 300);
    void window.pi
      .settingsUsageReport()
      .then(
        (value) => {
          if (!closed) {
            setCompleted(request);
            setReport(value);
            setError(false);
          }
        },
        () => {
          if (!closed) {
            setCompleted(request);
            setError(true);
          }
        },
      )
      .finally(() => {
        window.clearTimeout(delay);
        if (!closed) setShowLoading(false);
      });
    return () => {
      closed = true;
      window.clearTimeout(delay);
    };
  }, [request]);

  const language = LOCALE_DETAILS[locale].htmlLang;
  const count = new Intl.NumberFormat(language);
  const cost = new Intl.NumberFormat(language, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    currencyDisplay: "code",
  });
  const date = new Intl.DateTimeFormat(language, { dateStyle: "medium" });
  const rows = report?.[group] ?? [];
  const isLoading = completed !== request;

  return (
    <section className="grid min-w-0 gap-4" aria-label={t("用量统计", locale)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          value={group}
          onValueChange={(next) => {
            if (next === "days" || next === "projects" || next === "models") setGroup(next);
          }}
        >
          <SelectTrigger aria-label={t("用量统计分组", locale)}>
            <SelectValue>{t(GROUP_LABELS[group], locale)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-40" alignItemWithTrigger={false}>
            <SelectGroup>
              {Object.entries(GROUP_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {t(label, locale)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          aria-disabled={isLoading}
          onClick={() => {
            if (!isLoading) setRequest((value) => value + 1);
          }}
        >
          {t("刷新", locale)}
        </Button>
      </div>
      {showLoading && (
        <output className="text-sm text-muted-foreground">{t("加载中…", locale)}</output>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t("无法读取用量。请重试。", locale)}
        </p>
      )}
      {!!report?.unreadableSessions && (
        <p role="alert" className="text-sm text-destructive">
          {t("有 {0} 个会话无法读取。修复会话存储或升级 Pilot 后刷新。", locale, [
            count.format(report.unreadableSessions),
          ])}
        </p>
      )}
      {report && (
        <div className="settings-list">
          <div className="settings-row flex-wrap" aria-live="polite">
            <p className="text-sm font-medium">
              {t("总计 {0} token", locale, [count.format(tokenCount(report.total))])}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("已记录费用 {0}", locale, [cost.format(report.total.costTotal)])}
            </p>
          </div>
          {rows.length ? (
            <ul aria-label={t(GROUP_LABELS[group], locale)}>
              {rows.map(({ key, label, description, usage }) => (
                <li key={key} className="settings-row flex-wrap border-t border-border/65">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="text-sm wrap-anywhere">
                      {label === null
                        ? t(UNKNOWN_LABELS[group], locale)
                        : group === "days"
                          ? date.format(new Date(label + "T00:00:00"))
                          : label}
                    </p>
                    {description && (
                      <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
                        {description}
                      </p>
                    )}
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm">
                      {t("{0} token", locale, [count.format(tokenCount(usage))])}
                    </p>
                    <p className="text-xs text-muted-foreground">{cost.format(usage.costTotal)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <ListEmpty
              title={t("没有可统计的会话用量。", locale)}
              description={t("运行一次聊天任务后刷新。", locale)}
            />
          )}
        </div>
      )}
    </section>
  );
}
