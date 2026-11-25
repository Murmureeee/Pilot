// @env browser
import { XIcon } from "lucide-react";
import type { JSX } from "react";

import {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@renderer/components/ui/attachment";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@renderer/components/ui/dialog";
import { t, useLocale } from "@renderer/lib/i18n";
import type { ImageAttachment } from "@shared/contract";

export function ImageAttachments({
  images,
  locations,
  className,
  remove,
}: {
  images: readonly ImageAttachment[];
  locations?: readonly string[];
  className?: string;
  remove?(index: number): void;
}): JSX.Element | null {
  const locale = useLocale();
  if (!images.length) return null;
  return (
    <AttachmentGroup aria-label={t("图片附件", locale)} className={className}>
      {images.map(({ name, mimeType, data }, index) => {
        const src = "data:" + mimeType + ";base64," + data;
        const openLabel = t("查看图片 {0}", locale, [name]);
        return (
          <Dialog key={locations?.[index] ?? index + "/" + name}>
            <Attachment className="w-18" data-transcript-part={locations?.[index]}>
              <AttachmentMedia>
                <img alt="" src={src} draggable={false} className="size-full object-cover" />
              </AttachmentMedia>
              <AttachmentTitle title={name}>{name}</AttachmentTitle>
              <DialogTrigger
                render={
                  <button
                    type="button"
                    className="absolute inset-0 cursor-pointer rounded-xl outline-none"
                    aria-label={openLabel}
                  />
                }
              />
              {remove && (
                <Button
                  type="button"
                  size="icon-xs"
                  variant="secondary"
                  className="absolute inset-e-1 inset-bs-1 shadow-sm"
                  aria-label={t("移除图片 {0}", locale, [name])}
                  onClick={() => remove(index)}
                >
                  <XIcon />
                </Button>
              )}
            </Attachment>
            <DialogContent
              className="max-h-[calc(100dvh-2rem)] gap-3 sm:max-w-3xl"
              closeLabel={t("关闭", locale)}
            >
              <DialogTitle className="truncate pe-9 text-sm leading-6">{name}</DialogTitle>
              <img
                data-image-preview
                alt={name}
                src={src}
                className="max-h-[calc(100dvh-7rem)] max-w-full justify-self-center rounded-lg object-contain"
              />
            </DialogContent>
          </Dialog>
        );
      })}
    </AttachmentGroup>
  );
}
