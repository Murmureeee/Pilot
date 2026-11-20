// @env browser
import { useState, type JSX } from "react";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";

export function PersonalizationSettings({
  savedInstructions,
}: {
  savedInstructions: string;
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
    <div className="grid gap-3">
      <div>
        <label htmlFor="custom-instructions" className="text-sm font-medium">
          {t("自定义指令", locale)}
        </label>
        <p id="custom-instructions-help" className="text-muted-foreground mt-0.5 text-xs leading-5">
          {t("默认用于所有会话。可通过会话菜单为单个聊天设置指令。", locale)}
        </p>
      </div>
      <Textarea
        id="custom-instructions"
        aria-describedby="custom-instructions-help"
        className="bg-card min-h-40 rounded-2xl px-4 py-3 leading-6"
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
        <p role="alert" className="text-destructive text-sm">
          {localizeError(error, locale)}
        </p>
      )}
    </div>
  );
}
