// @env browser
import { Field } from "@base-ui/react/field";
import { useRef, useState, type JSX } from "react";

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
import { Textarea } from "@renderer/components/ui/textarea";
import { t, useLocale } from "@renderer/lib/i18n";
import { fillPromptTemplate, promptParameters } from "@renderer/lib/prompt-templates";
import type { PromptTemplateRequest } from "@renderer/lib/types";
import { PROMPT_TEMPLATE_PREFIX } from "@shared/constants";

export function PromptTemplateDialog({
  request,
  onClose,
}: {
  request: PromptTemplateRequest;
  onClose(): void;
}): JSX.Element {
  const { template, insert } = request;
  const locale = useLocale();
  const [open, setOpen] = useState(true);
  const result = useRef<string | null>(null);
  const parameters = promptParameters(template.text);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (next) return;
        onClose();
        if (result.current !== null) insert(result.current);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("填写模板参数", locale)}</DialogTitle>
          <DialogDescription className="font-mono wrap-anywhere">
            /{PROMPT_TEMPLATE_PREFIX}
            {template.name}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const values = new Map(parameters.map((name) => [name, String(data.get(name) ?? "")]));
            result.current = fillPromptTemplate(template.text, values);
            setOpen(false);
          }}
        >
          {parameters.map((name) => (
            <Field.Root key={name} name={name} className="grid gap-1.5">
              <Field.Label className="text-sm wrap-anywhere">{name}</Field.Label>
              <Field.Control render={<Textarea rows={2} required />} />
            </Field.Root>
          ))}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              {t("取消", locale)}
            </DialogClose>
            <Button type="submit">{t("填入草稿", locale)}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
