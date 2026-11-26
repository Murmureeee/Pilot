// @env browser
import { useRef, useState, type FormEvent, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Textarea } from "@renderer/components/ui/textarea";
import { EXTERNAL_EDITOR_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { ExternalEditor } from "@shared/contract";

import { SettingsGroup, SettingsItem } from "./SettingsGroup";

export function ExternalEditorSettings({
  editor,
  isWindows,
}: {
  editor: ExternalEditor;
  isWindows: boolean;
}): JSX.Element {
  const locale = useLocale();
  const saveExternalEditor = useAgentStore((state) => state.saveExternalEditor);
  const [draft, setDraft] = useState(editor);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [invalidArgs, setInvalidArgs] = useState(false);
  const argsField = useRef<HTMLTextAreaElement>(null);
  const dirty =
    draft.kind !== editor.kind ||
    ("command" in draft && "command" in editor && draft.command !== editor.command) ||
    (draft.kind === "custom" &&
      editor.kind === "custom" &&
      draft.args.join("\n") !== editor.args.join("\n"));
  const items = (Object.keys(EXTERNAL_EDITOR_LABELS) as ExternalEditor["kind"][]).map((value) => ({
    label: t(EXTERNAL_EDITOR_LABELS[value], locale),
    value,
  }));

  const change = (next: ExternalEditor): void => {
    setDraft(next);
    setSaved(false);
    setError(undefined);
    setInvalidArgs(false);
  };

  const choose = (kind: ExternalEditor["kind"] | null): void => {
    if (kind === null || kind === draft.kind) return;
    if (kind === editor.kind) change(editor);
    else if (kind === "custom") change({ kind, command: "", args: ["{file}"] });
    else if (kind === "jetbrains") change({ kind, command: "" });
    else change({ kind });
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!dirty || saving) return;
    if (draft.kind === "custom" && !draft.args.some((argument) => argument.includes("{file}"))) {
      setInvalidArgs(true);
      argsField.current?.focus();
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const next = draft.kind === "custom" ? { ...draft, args: draft.args.filter(Boolean) } : draft;
      setDraft(await saveExternalEditor(next));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup
      id="settings-external-editor"
      title={t("外部编辑器", locale)}
      description={t("用于打开文件预览中的文件和定位 Git 差异行。", locale)}
    >
      <form className="grid gap-3" onSubmit={(event) => void save(event)}>
        <div className="settings-list">
          <SettingsItem label={t("编辑器", locale)} htmlFor="external-editor-kind">
            <Select value={draft.kind} items={items} disabled={saving} onValueChange={choose}>
              <SelectTrigger id="external-editor-kind" className="max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {items.map(({ label, value }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsItem>
          {"command" in draft && (
            <div className="settings-row">
              <div className="grid w-full min-w-0 gap-1.5">
                <label htmlFor="external-editor-command" className="text-sm font-medium">
                  {t("启动程序", locale)}
                </label>
                <Input
                  id="external-editor-command"
                  aria-describedby="external-editor-command-help"
                  value={draft.command}
                  disabled={saving}
                  required
                  spellCheck={false}
                  onChange={(event) => change({ ...draft, command: event.currentTarget.value })}
                />
                <p
                  id="external-editor-command-help"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {t(
                    isWindows
                      ? "填写 .exe 文件的绝对路径，或 PATH 中的程序名。"
                      : "填写可执行文件的绝对路径，或 PATH 中的程序名。",
                    locale,
                  )}
                  {draft.kind === "jetbrains" &&
                    " " +
                      t(
                        isWindows
                          ? "例如 idea64.exe 或 webstorm64.exe。"
                          : "例如 idea 或 webstorm。",
                        locale,
                      )}
                </p>
              </div>
            </div>
          )}
          {draft.kind === "custom" && (
            <div className="settings-row">
              <div className="grid w-full min-w-0 gap-1.5">
                <label htmlFor="external-editor-args" className="text-sm font-medium">
                  {t("启动参数", locale)}
                </label>
                <Textarea
                  ref={argsField}
                  id="external-editor-args"
                  aria-describedby={
                    invalidArgs
                      ? "external-editor-args-help external-editor-args-error"
                      : "external-editor-args-help"
                  }
                  aria-invalid={invalidArgs || undefined}
                  className="field-sizing-fixed font-mono"
                  value={draft.args.join("\n")}
                  disabled={saving}
                  rows={3}
                  spellCheck={false}
                  onChange={(event) =>
                    change({ ...draft, args: event.currentTarget.value.split("\n") })
                  }
                />
                <p
                  id="external-editor-args-help"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {t("每行填写一个参数。用 {file} 传入文件路径，用 {line} 传入行号。", locale)}
                </p>
                {invalidArgs && (
                  <p
                    id="external-editor-args-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {t("请在启动参数中加入 {file}。", locale)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && (
            <output className="text-xs text-muted-foreground">{t("已保存", locale)}</output>
          )}
          <Button type="submit" size="sm" disabled={!dirty || saving}>
            {saving ? t("保存中…", locale) : t("保存", locale)}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm wrap-anywhere text-destructive">
            {localizeError(error, locale)}
          </p>
        )}
      </form>
    </SettingsGroup>
  );
}
