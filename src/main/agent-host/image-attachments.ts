// @env node
import { z } from "zod";

import {
  IMAGE_ATTACHMENT_LIMIT,
  IMAGE_ATTACHMENT_MAX_BYTES,
  IMAGE_ATTACHMENT_MIME_TYPES,
  IMAGE_ATTACHMENT_NAME_LIMIT,
} from "../../shared/constants";
import type { ImageAttachment } from "../../shared/contract";
import {
  imageAttachmentName,
  imageMimeType,
  isImageAttachmentMimeType,
} from "../../shared/image-attachments";
import type { ReferencedUserMessage } from "./types";

const maxBase64Length = Math.ceil(IMAGE_ATTACHMENT_MAX_BYTES / 3) * 4;

export const imageAttachmentsSchema = z
  .array(
    z
      .strictObject({
        type: z.literal("image"),
        name: z
          .string()
          .trim()
          .min(1)
          .max(IMAGE_ATTACHMENT_NAME_LIMIT)
          .regex(/^[^\p{Cc}]+$/u),
        mimeType: z.enum(IMAGE_ATTACHMENT_MIME_TYPES),
        data: z
          .string()
          .max(maxBase64Length)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/)
          .refine((value) => value.length % 4 === 0),
      })
      .refine(({ data, mimeType }) => {
        const bytes = Buffer.from(data, "base64");
        return bytes.length <= IMAGE_ATTACHMENT_MAX_BYTES && imageMimeType(bytes) === mimeType;
      }),
  )
  .max(IMAGE_ATTACHMENT_LIMIT);

export function messageImages(message: ReferencedUserMessage): ImageAttachment[] {
  if (!Array.isArray(message.content)) return [];
  const images: ImageAttachment[] = [];
  for (const block of message.content) {
    if (!block || block.type !== "image") continue;
    const { mimeType, data } = block;
    if (
      typeof mimeType !== "string" ||
      !isImageAttachmentMimeType(mimeType) ||
      typeof data !== "string"
    )
      continue;
    const name = message.pilotImageNames?.[images.length];
    images.push({
      type: "image",
      name: imageAttachmentName(typeof name === "string" ? name : "", mimeType),
      mimeType,
      data,
    });
  }
  return images;
}
