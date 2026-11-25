// @env all
import { IMAGE_ATTACHMENT_MIME_TYPES, IMAGE_ATTACHMENT_NAME_LIMIT } from "./constants";
import type { ImageAttachment, ImageAttachmentMimeType, UiPart } from "./contract";

export function isImageAttachmentMimeType(value: string): value is ImageAttachmentMimeType {
  return IMAGE_ATTACHMENT_MIME_TYPES.some((type) => type === value);
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

export function imageMimeType(bytes: Uint8Array): ImageAttachmentMimeType | undefined {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (startsWith(bytes, [255, 216, 255])) return "image/jpeg";
  if (
    startsWith(bytes, [71, 73, 70, 56]) &&
    (bytes[4] === 55 || bytes[4] === 57) &&
    bytes[5] === 97
  )
    return "image/gif";
  if (startsWith(bytes, [82, 73, 70, 70]) && startsWith(bytes, [87, 69, 66, 80], 8))
    return "image/webp";
  return undefined;
}

export function imageAttachmentName(name: string, mimeType: ImageAttachmentMimeType): string {
  return (
    name
      .replace(/[\p{Cc}]/gu, "")
      .trim()
      .slice(0, IMAGE_ATTACHMENT_NAME_LIMIT) ||
    "image." + (mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1])
  );
}

export function imagesFromMessageParts(parts: readonly UiPart[]): ImageAttachment[] {
  return parts.filter((part) => part.type === "image");
}
