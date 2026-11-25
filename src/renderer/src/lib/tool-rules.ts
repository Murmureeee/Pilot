// @env browser
import type { CommandPrefix, Locale, ToolRule } from "@shared/contract";
import { isWebTool } from "@shared/web";

import { COMMAND_SHELL_LABELS } from "./constants";
import { t } from "./i18n";

function formatCommandPrefix({ shell, args }: CommandPrefix): string {
  const powershell = shell === "powershell";
  const bareWord = powershell ? /^[a-zA-Z0-9_./:\\%+=-]+$/ : /^[a-zA-Z0-9_./:@%+,=-]+$/;
  return args
    .map((arg) => {
      if (bareWord.test(arg)) return arg;
      return "'" + arg.replaceAll("'", powershell ? "''" : "'\\''") + "'";
    })
    .join(" ");
}

export function describeToolScope(rule: ToolRule, locale: Locale): string {
  if (isWebTool(rule.toolName))
    return rule.domain
      ? t("仅域名 {0}", locale, [rule.domain])
      : t("此联网授权缺少有效域名。请重新授权。", locale);
  if (rule.toolName === "bash") {
    const { commandPrefix } = rule;
    if (!commandPrefix) return t("旧命令授权已停用。下次运行时可重新授权。", locale);
    const shell =
      commandPrefix.shell === "bash" && !navigator.userAgent.includes("Windows")
        ? "Bash"
        : COMMAND_SHELL_LABELS[commandPrefix.shell];
    return t("以 {1} 开头的 {0} 命令", locale, [shell, formatCommandPrefix(commandPrefix)]);
  }
  return rule.pathPrefix ? t("仅路径前缀 {0}", locale, [rule.pathPrefix]) : t("全部调用", locale);
}
