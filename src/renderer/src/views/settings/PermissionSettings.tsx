// @env browser
import { useState, type JSX } from "react";
import { CheckIcon, EyeIcon, ShieldCheckIcon, ZapIcon } from "lucide-react";
import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import { APPROVAL_MODE_OPTIONS, TOOL_RULE_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { ApprovalMode, PublicSettings } from "@shared/contract";
import { cn } from "cn";
import { SettingsGroup } from "./SettingsGroup";

const MODE_ICONS: Record<ApprovalMode, typeof EyeIcon> = {
  standard: ShieldCheckIcon,
  "read-only": EyeIcon,
  "full-access": ZapIcon,
};

const RISK_TEXT = "text-amber-600 dark:text-amber-400";

export function PermissionSettings({ settings }: { settings: PublicSettings }): JSX.Element {
  const locale = useLocale();
  const setDefaultApprovalMode = useAgentStore((s) => s.setDefaultApprovalMode);
  const removeToolRule = useAgentStore((s) => s.removeToolRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = settings.approvalMode;
  const rules = settings.toolRules ?? [];

  const update = async (action: () => Promise<void>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-9">
      <SettingsGroup
        id="settings-approval-mode"
        title={t("默认权限模式", locale)}
        description={t(
          "没有单独选择模式的聊天都使用此模式，包括已有聊天。可在输入框为单个聊天单独选择。",
          locale,
        )}
      >
        <fieldset aria-labelledby="settings-approval-mode" className="settings-list min-w-0">
          {(Object.keys(APPROVAL_MODE_OPTIONS) as ApprovalMode[]).map((option) => {
            const Icon = MODE_ICONS[option];
            const selected = option === mode;
            const risk = option === "full-access" && RISK_TEXT;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                disabled={saving}
                onClick={() => {
                  if (!selected) void update(() => setDefaultApprovalMode(option));
                }}
                className="group focus-visible:ring-ring flex w-full items-start gap-3 py-4 text-left outline-none focus-visible:ring-2 disabled:opacity-60"
              >
                <Icon
                  aria-hidden="true"
                  className={cn("mt-0.5 size-4 shrink-0", risk)}
                  strokeWidth={1.7}
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={cn("text-sm font-medium group-hover:underline", risk)}>
                    {t(APPROVAL_MODE_OPTIONS[option].label, locale)}
                  </span>
                  <span className="text-muted-foreground text-xs leading-5">
                    {t(APPROVAL_MODE_OPTIONS[option].description, locale)}
                  </span>
                </span>
                {selected && <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
              </button>
            );
          })}
        </fieldset>
      </SettingsGroup>

      <SettingsGroup
        id="settings-saved-rules"
        title={t("已保存的授权", locale)}
        description={t(
          "在审批时选择「总是允许」会保存规则，命中规则的操作不再询问。撤销后下一次调用恢复询问。",
          locale,
        )}
      >
        <div className="settings-list">
          {rules.length === 0 && (
            <ListEmpty
              title={t("还没有保存的授权", locale)}
              description={t("保存的规则会列在这里，可以查看范围并撤销。", locale)}
            />
          )}
          {rules.map((rule) => (
            <div key={JSON.stringify(rule)} className="settings-row">
              <div className="min-w-0 flex-1 basis-44">
                <p className="wrap-anywhere text-sm font-medium">
                  {rule.toolName in TOOL_RULE_LABELS
                    ? t(TOOL_RULE_LABELS[rule.toolName], locale)
                    : rule.toolName}
                </p>
                <p className="text-muted-foreground wrap-anywhere text-xs leading-5">
                  {rule.pathPrefix
                    ? t("仅路径前缀 {0}", locale, [rule.pathPrefix])
                    : t("全部调用", locale)}
                </p>
                {rule.toolName === "bash" && !rule.pathPrefix && (
                  <p className={cn("text-xs leading-5", RISK_TEXT)}>
                    {t("此规则允许运行任何命令。", locale)}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => void update(() => removeToolRule(rule))}
              >
                {t("撤销规则", locale)}
              </Button>
            </div>
          ))}
        </div>
      </SettingsGroup>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {localizeError(error, locale)}
        </p>
      )}
    </div>
  );
}
