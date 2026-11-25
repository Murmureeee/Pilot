// @env browser
import { useState } from "react";

import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { ComposerImages } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { IMAGE_ATTACHMENT_LIMIT, IMAGE_ATTACHMENT_MAX_BYTES } from "@shared/constants";
import type { ImageAttachment } from "@shared/contract";
import {
  imageAttachmentName,
  imageMimeType,
  isImageAttachmentMimeType,
} from "@shared/image-attachments";

export function isDroppedImage(file: File): boolean {
  return isImageAttachmentMimeType(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

async function readImage(file: File): Promise<ImageAttachment> {
  if (file.size > IMAGE_ATTACHMENT_MAX_BYTES)
    throw new Error("每张图片最多 5 MB，请选择较小的图片。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = imageMimeType(bytes);
  if (!mimeType) throw new Error("请选择 PNG、JPEG、WebP 或 GIF 图片。");
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    bitmap.close();
  } catch {
    throw new Error("无法读取这张图片，请重新选择。");
  }
  return {
    type: "image",
    name: imageAttachmentName(file.name, mimeType),
    mimeType,
    data: bytes.toBase64(),
  };
}

export function useComposerImages(composerId: string): ComposerImages {
  const locale = useLocale();
  const images = useAgentStore((state) => state.draftImages);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: ImageAttachment[]): Promise<void> => {
    try {
      await useAgentStore.getState().saveDraftImages(composerId, next);
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : String(cause), locale));
    }
  };

  const add = async (files: File[]): Promise<void> => {
    if (!files.length) return;
    const initial = useAgentStore.getState();
    if (initial.composerId !== composerId) return;
    const limitMessage = t("每条消息最多可添加 {0} 张图片。", locale, [IMAGE_ATTACHMENT_LIMIT]);
    const room = IMAGE_ATTACHMENT_LIMIT - initial.draftImages.length;
    if (!room) {
      setError(limitMessage);
      return;
    }
    setError(null);
    setPending((count) => count + 1);
    try {
      const added: ImageAttachment[] = [];
      let message: string | null = null;
      for (const file of files) {
        if (added.length >= room) {
          message ??= limitMessage;
          break;
        }
        try {
          added.push(await readImage(file));
        } catch (cause) {
          message ??= t("{0} · {1}", locale, [
            file.name,
            localizeError(cause instanceof Error ? cause.message : String(cause), locale),
          ]);
        }
      }
      const current = useAgentStore.getState();
      if (current.composerId !== composerId) return;
      const available = IMAGE_ATTACHMENT_LIMIT - current.draftImages.length;
      if (added.length > available) message ??= limitMessage;
      setError(message);
      if (added.length && available)
        await save([...current.draftImages, ...added.slice(0, available)]);
    } finally {
      setPending((count) => count - 1);
    }
  };

  return {
    images,
    pending: pending > 0,
    error,
    add,
    remove: (index) => {
      setError(null);
      return save(useAgentStore.getState().draftImages.filter((_, i) => i !== index));
    },
    replace: (next) => save(next),
  };
}
