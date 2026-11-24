// @env browser
import type { JSX } from "react";

export function ListEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <output className="flex flex-col gap-0.5 py-4">
      <span className="text-sm">{title}</span>
      <span className="text-muted-foreground text-xs leading-5">{description}</span>
    </output>
  );
}
