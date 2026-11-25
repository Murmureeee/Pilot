// @env browser
import { cn } from "cn";
import type { ComponentProps, JSX } from "react";

function Attachment({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="attachment"
      className={cn(
        "group/attachment relative flex min-w-0 shrink-0 flex-col gap-1 rounded-xl border border-border bg-card p-1 text-card-foreground focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentGroup({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "flex min-w-0 snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain py-1 *:data-[slot=attachment]:snap-start",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentMedia({ className, ...props }: ComponentProps<"div">): JSX.Element {
  return (
    <div
      data-slot="attachment-media"
      className={cn(
        "flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function AttachmentTitle({ className, ...props }: ComponentProps<"span">): JSX.Element {
  return (
    <span
      data-slot="attachment-title"
      className={cn("min-w-0 truncate px-0.5 text-xs leading-4 text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Attachment, AttachmentGroup, AttachmentMedia, AttachmentTitle };
