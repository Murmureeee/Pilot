// @env browser
// 相对时间格式化（命令面板会话列表用）。
import type { Locale } from "@shared/contract";

import { LOCALE_DETAILS } from "../../../shared/constants";
import { t } from "./i18n";

const englishRelative = new Intl.RelativeTimeFormat("en");

export function relativeTime(timestamp: number, locale: Locale, now: number = Date.now()): string {
  const diff = now - timestamp;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) return t("刚刚", locale);
  if (diff < day) {
    const hours = diff >= hour;
    const count = Math.floor(diff / (hours ? hour : minute));
    return locale === "en"
      ? englishRelative.format(-count, hours ? "hour" : "minute")
      : t(hours ? "{0} 小时前" : "{0} 分钟前", locale, [count]);
  }
  if (diff < 2 * day) return t("昨天", locale);
  return new Date(timestamp).toLocaleDateString(LOCALE_DETAILS[locale].htmlLang);
}
