// @env browser
import type { Locale } from "@shared/contract";

import { t } from "./i18n";

/** 步骤耗时：一分钟内保留一位小数，更长的写成「2 分 13 秒」。 */
export function formatDuration(ms: number, locale: Locale): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t("{0} 秒", locale, [Math.max(0.1, Math.round(ms / 100) / 10)]);
  return t("{0} 分 {1} 秒", locale, [Math.floor(seconds / 60), seconds % 60]);
}

/** 进行中的计时每秒跳一次，只写整秒。 */
export function formatElapsed(ms: number, locale: Locale): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return t("{0} 秒", locale, [seconds]);
  return t("{0} 分 {1} 秒", locale, [Math.floor(seconds / 60), seconds % 60]);
}
