// @env browser
import type { Locale } from "@shared/contract";
import { t } from "./i18n";

export function importSummary(
  counts: { skills: number; servers: number; plugins?: number },
  locale: Locale,
): string {
  const parts = [];
  const { skills, servers, plugins = 0 } = counts;
  if (skills > 0) parts.push(t(skills === 1 ? "1 个技能" : "{0} 个技能", locale, [skills]));
  if (servers > 0)
    parts.push(t(servers === 1 ? "1 个 MCP 服务" : "{0} 个 MCP 服务", locale, [servers]));
  if (plugins > 0)
    parts.push(t(plugins === 1 ? "1 组插件组件" : "{0} 组插件组件", locale, [plugins]));
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(parts);
}
