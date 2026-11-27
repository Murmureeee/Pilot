// @env browser
import type { Locale } from "@shared/contract";

import { LOCALE_DETAILS } from "../../../shared/constants";
import { t } from "./i18n";

export function importSummary(
  counts: { skills: number; servers: number; plugins?: number; templates?: number },
  locale: Locale,
): string {
  const parts = [];
  const { skills, servers, plugins = 0, templates = 0 } = counts;
  if (skills > 0) parts.push(t(skills === 1 ? "1 个技能" : "{0} 个技能", locale, [skills]));
  if (servers > 0)
    parts.push(t(servers === 1 ? "1 个 MCP 服务" : "{0} 个 MCP 服务", locale, [servers]));
  if (plugins > 0)
    parts.push(t(plugins === 1 ? "1 组插件组件" : "{0} 组插件组件", locale, [plugins]));
  if (templates > 0)
    parts.push(t(templates === 1 ? "1 个提示词模板" : "{0} 个提示词模板", locale, [templates]));
  return new Intl.ListFormat(LOCALE_DETAILS[locale].htmlLang, { type: "conjunction" }).format(
    parts,
  );
}
