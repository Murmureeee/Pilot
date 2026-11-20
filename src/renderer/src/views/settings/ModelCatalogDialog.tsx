// @env browser
import { useState, type JSX } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { cn } from "cn";
import type { ModelCatalogDialogProps } from "./types";

export function ModelCatalogDialog({
  catalog,
  savedModels,
  onAdd,
  onClose,
}: ModelCatalogDialogProps): JSX.Element {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const entries = catalog.state === "loaded" ? catalog.models : [];
  const search = query.trim().toLowerCase();
  const matches = entries.filter(
    ({ id, name }) =>
      !search || id.toLowerCase().includes(search) || name.toLowerCase().includes(search),
  );
  const saved = new Set(savedModels.map(({ id }) => id));
  const addable = matches.filter(({ id }) => !saved.has(id));
  const allSelected = addable.length > 0 && addable.every(({ id }) => selected.includes(id));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("关闭", locale)} className="max-h-[min(35rem,85vh)] gap-4">
        <DialogHeader>
          <DialogTitle>{t("模型目录", locale)}</DialogTitle>
          <DialogDescription>{t("勾选要加入此提供方的模型。", locale)}</DialogDescription>
        </DialogHeader>
        {catalog.state === "loading" && (
          <output className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
            <LoaderCircleIcon aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            {t("加载中…", locale)}
          </output>
        )}
        {catalog.state === "error" && (
          <p role="alert" className="text-destructive wrap-anywhere text-sm">
            {localizeError(catalog.error, locale)}
          </p>
        )}
        {catalog.state === "loaded" && (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <Input
                aria-label={t("搜索模型", locale)}
                placeholder={t("搜索模型", locale)}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                disabled={addable.length === 0}
                onClick={() => {
                  const ids = new Set(addable.map(({ id }) => id));
                  setSelected((previous) =>
                    allSelected
                      ? previous.filter((id) => !ids.has(id))
                      : [...new Set([...previous, ...ids])],
                  );
                }}
              >
                {t(allSelected ? "取消全选" : "全选", locale)}
              </Button>
            </div>
            <div className="min-h-0 max-h-[min(20rem,44vh)] overflow-y-auto overscroll-contain rounded-xl border p-1 [scrollbar-width:thin]">
              {matches.length === 0 && (
                <p className="text-muted-foreground px-2 py-3 text-sm">
                  {t("没有匹配的模型", locale)}
                </p>
              )}
              {matches.map((model) => {
                const added = saved.has(model.id);
                const checked = added || selected.includes(model.id);
                return (
                  <label
                    key={model.id}
                    title={added ? t("已添加", locale) : model.id}
                    className={cn(
                      "hover:bg-accent focus-within:ring-ring flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-start focus-within:ring-2 focus-within:ring-inset",
                      checked && "bg-accent/60",
                      added && "opacity-55",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={added}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setSelected((ids) =>
                          enabled ? [...ids, model.id] : ids.filter((id) => id !== model.id),
                        );
                      }}
                      className="sr-only"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm">{model.name}</span>
                      {model.name !== model.id && (
                        <span className="text-muted-foreground truncate text-xs">{model.id}</span>
                      )}
                    </span>
                    {checked && <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
                  </label>
                );
              })}
            </div>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            {t("取消", locale)}
          </Button>
          <Button
            type="button"
            disabled={selected.length === 0}
            onClick={() =>
              onAdd(entries.filter(({ id }) => selected.includes(id) && !saved.has(id)))
            }
          >
            {t("添加 {0} 个模型", locale, [selected.length])}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
