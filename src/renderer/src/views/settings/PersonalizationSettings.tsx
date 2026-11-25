// @env browser
import { useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { PromptTemplate } from "@shared/contract";

import { PromptTemplateSettings } from "./PromptTemplateSettings";
import { SettingsGroup } from "./SettingsGroup";

const INSTRUCTION_ORDER = [
  { label: "应用内置指令", description: "安全与工具使用规则，始终优先。" },
  {
    label: "项目指令",
    description: "读取 AGENTS.md 或 CLAUDE.md。同一路径上，越接近目标的目录越优先。",
  },
  { label: "会话指令", description: "未单独设置时使用上面的自定义指令。" },
  { label: "已启用的技能", description: "任务需要时读取技能指令。" },
] as const;

export function PersonalizationSettings({
  savedInstructions,
  templates,
}: {
  savedInstructions: string;
  templates: readonly PromptTemplate[];
}): JSX.Element {
  const locale = useLocale();
  const savePersona = useAgentStore((s) => s.savePersona);
  const [draft, setDraft] = useState(savedInstructions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasChanges = draft !== savedInstructions;

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await savePersona(draft.trim());
      setDraft(draft.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-9">
      <div className="grid gap-3">
        <div>
          <label htmlFor="custom-instructions" className="text-sm font-medium">
            {t("自定义指令", locale)}
          </label>
          <p
            id="custom-instructions-help"
            className="mt-0.5 text-xs leading-5 text-muted-foreground"
          >
            {t("默认用于所有会话。可通过会话菜单为单个聊天设置指令。", locale)}
          </p>
        </div>
        <Textarea
          id="custom-instructions"
          aria-describedby="custom-instructions-help"
          className="min-h-40 rounded-2xl bg-card px-4 py-3 leading-6"
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          rows={8}
        />
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || !hasChanges}
            onClick={() => {
              setDraft(savedInstructions);
              setError(null);
            }}
          >
            {t("撤销修改", locale)}
          </Button>
          <Button size="sm" disabled={saving || !hasChanges} onClick={() => void save()}>
            {t(saving ? "保存中…" : "保存", locale)}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {localizeError(error, locale)}
          </p>
        )}
      </div>
      <PromptTemplateSettings templates={templates} />
      <SettingsGroup
        id="settings-instruction-order"
        title={t("指令生效顺序", locale)}
        description={t("内容冲突时，排在前面的优先。", locale)}
      >
        <ol className="settings-list">
          {INSTRUCTION_ORDER.map((item, index) => (
            <li key={item.label} className="flex items-start gap-3 py-3.5">
              <span className="mt-0.5 w-4 text-xs text-muted-foreground tabular-nums">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{t(item.label, locale)}</span>
                <span className="text-xs leading-5 text-muted-foreground">
                  {t(item.description, locale)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </SettingsGroup>
    </div>
  );
}
