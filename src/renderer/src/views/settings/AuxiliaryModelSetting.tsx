// @env browser
import { ChevronDownIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { displayProviderName, t, useLocale } from "@renderer/lib/i18n";
import type { SessionModelSelection } from "@shared/contract";

import type { DraftProvider } from "./types";

function modelValue(selection: SessionModelSelection): string {
  return JSON.stringify([selection.providerId, selection.modelId]);
}

export function AuxiliaryModelSetting({
  providers,
  selection,
  disabled,
  onChange,
}: {
  providers: DraftProvider[];
  selection: SessionModelSelection | null;
  disabled: boolean;
  onChange(model: SessionModelSelection | null): void;
}): JSX.Element {
  const locale = useLocale();
  const items = providers.flatMap((provider) =>
    provider.models.map((model) => {
      const option = { providerId: provider.id, modelId: model.id };
      return {
        selection: option,
        value: modelValue(option),
        name: model.name || model.id,
        providerName: displayProviderName(provider, locale),
      };
    }),
  );
  const value = selection ? modelValue(selection) : "";
  const follow = t("跟随当前模型", locale);
  const label = items.find((item) => item.value === value)?.name ?? follow;
  return (
    <div className="settings-row">
      <div className="min-w-0 flex-1 basis-48">
        <h3 id="auxiliary-model-label" className="text-sm font-medium">
          {t("辅助模型", locale)}
        </h3>
        <p id="auxiliary-model-help" className="text-xs leading-5 text-muted-foreground">
          {t("用于生成首轮会话标题和上下文压缩摘要。", locale)}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              className="max-w-full min-w-0"
              aria-label={t("辅助模型", locale)}
              aria-describedby="auxiliary-model-help"
              title={label}
              disabled={disabled || !items.length}
            />
          }
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-(--available-width)">
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) =>
              onChange(items.find((item) => item.value === next)?.selection ?? null)
            }
          >
            <DropdownMenuRadioItem value="" closeOnClick>
              {follow}
            </DropdownMenuRadioItem>
            {items.length > 0 && <DropdownMenuSeparator />}
            {items.map((item) => (
              <DropdownMenuRadioItem
                className="items-start"
                key={item.value}
                value={item.value}
                closeOnClick
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate">{item.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.providerName}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
