// @env browser
import { SlidersHorizontalIcon } from "lucide-react";
import { useId, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { t, useLocale } from "@renderer/lib/i18n";
import { OPENAI_RESPONSES_MIN_TOKENS } from "@shared/constants";
import type { ModelCapabilities, ProviderKind } from "@shared/contract";
import { modelTokenLimit } from "@shared/model-capabilities";

import { SettingsItem } from "./SettingsGroup";
import type { DraftModel } from "./types";

export function ModelCapabilitiesDialog({
  model,
  kind,
  onApply,
}: {
  model: DraftModel;
  kind: ProviderKind;
  onApply(overrides?: Partial<ModelCapabilities>): void;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const label = t("配置模型能力 {0}", locale, [model.name]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="mt-0.5 text-muted-foreground"
            aria-label={label}
            title={label}
          />
        }
      >
        <SlidersHorizontalIcon aria-hidden="true" />
      </DialogTrigger>
      <DialogContent
        closeLabel={t("关闭", locale)}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("模型能力", locale)}</DialogTitle>
          <DialogDescription className="wrap-anywhere">{model.name}</DialogDescription>
        </DialogHeader>
        {open && (
          <CapabilityForm
            model={model}
            kind={kind}
            onCancel={() => setOpen(false)}
            onApply={(overrides) => {
              onApply(overrides);
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CapabilityForm({
  model,
  kind,
  onCancel,
  onApply,
}: {
  model: DraftModel;
  kind: ProviderKind;
  onCancel(): void;
  onApply(overrides?: Partial<ModelCapabilities>): void;
}): JSX.Element {
  const locale = useLocale();
  const uid = useId();
  const [context, setContext] = useState(model.overrides?.contextWindow?.toString() ?? "");
  const [output, setOutput] = useState(model.overrides?.maxTokens?.toString() ?? "");
  const [images, setImages] = useState(model.overrides?.supportsImages);
  const [thinking, setThinking] = useState(model.overrides?.supportsThinking);
  const contextWindow = modelTokenLimit(Number(context));
  const maxTokens = modelTokenLimit(Number(output));
  const invalidContext = context !== "" && contextWindow === undefined;
  const invalidOutput = output !== "" && maxTokens === undefined;
  const minimum = kind === "openai-responses" ? OPENAI_RESPONSES_MIN_TOKENS : 1;
  const tooSmall = (contextWindow ?? minimum) < minimum || (maxTokens ?? minimum) < minimum;
  const invalid = invalidContext || invalidOutput || tooSmall;
  const submit = (): void => {
    if (invalid) return;
    const overrides: Partial<ModelCapabilities> = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(images === undefined ? {} : { supportsImages: images }),
      ...(thinking === undefined ? {} : { supportsThinking: thinking }),
    };
    onApply(Object.keys(overrides).length ? overrides : undefined);
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="grid min-w-0 gap-3"
    >
      <p className="text-xs leading-5 text-muted-foreground">
        {t("留空或选自动时使用目录数据或默认值。应用后，在提供方页面保存更改。", locale)}
      </p>
      <div className="settings-list">
        <SettingsItem label={t("上下文长度（tokens）", locale)} htmlFor={uid + "-context"}>
          <Input
            id={uid + "-context"}
            type="number"
            min={minimum}
            step={1}
            value={context}
            placeholder={
              (model.contextWindow ?? model.automatic?.contextWindow)?.toString() ??
              t("自动", locale)
            }
            aria-invalid={invalidContext || (contextWindow ?? minimum) < minimum}
            onChange={(event) => setContext(event.currentTarget.value)}
            className="w-36"
          />
        </SettingsItem>
        <SettingsItem label={t("输出上限（tokens）", locale)} htmlFor={uid + "-output"}>
          <Input
            id={uid + "-output"}
            type="number"
            min={minimum}
            step={1}
            value={output}
            placeholder={
              (model.maxTokens ?? model.automatic?.maxTokens)?.toString() ?? t("自动", locale)
            }
            aria-invalid={invalidOutput || (maxTokens ?? minimum) < minimum}
            onChange={(event) => setOutput(event.currentTarget.value)}
            className="w-36"
          />
        </SettingsItem>
        <SettingsItem label={t("图像输入", locale)} htmlFor={uid + "-images"}>
          <CapabilitySelect
            id={uid + "-images"}
            value={images}
            automatic={model.supportsImages ?? model.automatic?.supportsImages}
            onChange={setImages}
          />
        </SettingsItem>
        <SettingsItem label={t("思考支持", locale)} htmlFor={uid + "-thinking"}>
          <CapabilitySelect
            id={uid + "-thinking"}
            value={thinking}
            automatic={model.supportsThinking ?? model.automatic?.supportsThinking}
            onChange={setThinking}
          />
        </SettingsItem>
      </div>
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t(
            tooSmall
              ? "Responses API 的上下文长度和输出上限至少为 16。"
              : "上下文长度和输出上限须为正整数。",
            locale,
          )}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("取消", locale)}
        </Button>
        <Button type="submit" disabled={invalid}>
          {t("应用能力设置", locale)}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CapabilitySelect({
  id,
  value,
  automatic,
  onChange,
}: {
  id: string;
  value?: boolean;
  automatic?: boolean;
  onChange(value?: boolean): void;
}): JSX.Element {
  const locale = useLocale();
  const flag = (supported: boolean): string => t(supported ? "支持" : "不支持", locale);
  const auto =
    automatic === undefined ? t("自动", locale) : t("自动（{0}）", locale, [flag(automatic)]);
  return (
    <Select
      value={value === undefined ? "auto" : value ? "yes" : "no"}
      onValueChange={(next) =>
        onChange(next === "auto" || next === null ? undefined : next === "yes")
      }
    >
      <SelectTrigger id={id} className="w-36">
        <SelectValue>{value === undefined ? auto : flag(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectItem value="auto">{auto}</SelectItem>
          <SelectItem value="yes">{flag(true)}</SelectItem>
          <SelectItem value="no">{flag(false)}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
