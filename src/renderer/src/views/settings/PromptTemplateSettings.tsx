// @env browser
import { Field } from "@base-ui/react/field";
import { PlusIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import {
  PROMPT_TEMPLATE_LIMIT,
  PROMPT_TEMPLATE_NAME_PATTERN,
  PROMPT_TEMPLATE_PREFIX,
  PROMPT_TEMPLATE_TEXT_LIMIT,
} from "@shared/constants";
import type { PromptTemplate } from "@shared/contract";

import { SettingsGroup } from "./SettingsGroup";
import type { PromptTemplateChange } from "./types";

export function PromptTemplateSettings({
  templates,
}: {
  templates: readonly PromptTemplate[];
}): JSX.Element {
  const locale = useLocale();
  const save = useAgentStore((state) => state.savePromptTemplates);
  const addButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [change, setChange] = useState<PromptTemplateChange | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removing = change?.kind === "remove";
  const original = change?.template;
  const canAdd = templates.length < PROMPT_TEMPLATE_LIMIT;
  const title = removing ? "删除提示词模板？" : original ? "编辑提示词模板" : "添加提示词模板";

  const start = (next: PromptTemplateChange, button: HTMLButtonElement): void => {
    trigger.current = button;
    setError(null);
    setChange(next);
    setOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving || !change) return;
    const remaining = templates.filter(({ name }) => name !== original?.name);
    let next = remaining;
    if (!removing) {
      const data = new FormData(event.currentTarget);
      const name = String(data.get("name") ?? "")
        .trim()
        .normalize("NFKC")
        .toLowerCase();
      const text = String(data.get("text") ?? "").trim();
      if (!PROMPT_TEMPLATE_NAME_PATTERN.test(name)) {
        setError("命令名称需以字母或数字开头，可使用字母、数字、下划线和连字符。");
        return;
      }
      if (remaining.some((template) => template.name === name)) {
        setError("该命令名称已存在。请换一个名称。");
        return;
      }
      if (!text) {
        setError("请输入提示词正文。");
        return;
      }
      const updated = { name, text };
      next = original
        ? templates.map((template) => (template.name === original.name ? updated : template))
        : [...templates, updated];
    }
    setError(null);
    setSaving(true);
    try {
      await save(next);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsGroup
      id="settings-prompt-templates"
      title={t("提示词模板", locale)}
      description={t("使用双花括号定义参数，例如 {{文件}}。从 / 菜单或命令面板调用模板。", locale)}
    >
      {templates.length > 0 && (
        <ul className="settings-list">
          {templates.map((template) => {
            const command = "/" + PROMPT_TEMPLATE_PREFIX + template.name;
            return (
              <li key={template.name} className="settings-row">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="font-mono text-sm wrap-anywhere">{command}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                    {template.text}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("编辑 {0}", locale, [command])}
                    onClick={(event) => start({ kind: "edit", template }, event.currentTarget)}
                  >
                    {t("编辑", locale)}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("删除 {0}", locale, [command])}
                    onClick={(event) => start({ kind: "remove", template }, event.currentTarget)}
                  >
                    {t("删除", locale)}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          ref={addButton}
          size="sm"
          variant="outline"
          disabled={!canAdd}
          onClick={(event) => start({ kind: "edit" }, event.currentTarget)}
        >
          <PlusIcon data-icon="inline-start" />
          {t("添加模板", locale)}
        </Button>
        {!canAdd && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t("最多可保存 {0} 个模板。", locale, [PROMPT_TEMPLATE_LIMIT])}
          </p>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
        onOpenChangeComplete={(next) => {
          if (!next) setChange(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          finalFocus={() => (trigger.current?.isConnected ? trigger.current : addButton.current)}
          className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto"
        >
          {change && (
            <>
              <DialogHeader>
                <DialogTitle>{t(title, locale)}</DialogTitle>
                <DialogDescription>
                  {removing
                    ? t("将删除 /{0}。", locale, [PROMPT_TEMPLATE_PREFIX + original?.name])
                    : t("保存后可用 /prompt-名称 调用。", locale)}
                </DialogDescription>
              </DialogHeader>
              <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
                {!removing && (
                  <>
                    <Field.Root name="name" disabled={saving} className="grid gap-1.5">
                      <Field.Label className="text-sm">{t("命令名称", locale)}</Field.Label>
                      <Field.Control
                        render={<Input defaultValue={original?.name} maxLength={40} required />}
                      />
                    </Field.Root>
                    <Field.Root name="text" disabled={saving} className="grid gap-1.5">
                      <Field.Label className="text-sm">{t("提示词正文", locale)}</Field.Label>
                      <Field.Control
                        render={
                          <Textarea
                            defaultValue={original?.text}
                            maxLength={PROMPT_TEMPLATE_TEXT_LIMIT}
                            rows={5}
                            required
                          />
                        }
                      />
                    </Field.Root>
                  </>
                )}
                {error && (
                  <p role="alert" className="text-xs wrap-anywhere text-destructive">
                    {localizeError(error, locale)}
                  </p>
                )}
                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" disabled={saving} />}
                  >
                    {t("取消", locale)}
                  </DialogClose>
                  <Button
                    type="submit"
                    variant={removing ? "destructive" : "default"}
                    disabled={saving}
                  >
                    {t(saving ? "保存中…" : removing ? "删除" : "保存", locale)}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
