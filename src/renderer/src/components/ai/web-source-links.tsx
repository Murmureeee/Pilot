// @env browser
import type { JSX } from "react";

import { t, useLocale } from "@renderer/lib/i18n";
import type { WebSource } from "@shared/contract";
import { webLink } from "@shared/web";

export function WebSourceLinks({
  sources,
  tool = false,
}: {
  sources: WebSource[];
  tool?: boolean;
}): JSX.Element {
  const locale = useLocale();
  return (
    <ul
      aria-label={t("网页来源", locale)}
      data-tool-sources={tool || undefined}
      className="grid min-w-0 gap-2"
    >
      {sources.map((source) => {
        const url = webLink(source.url);
        if (!url) return null;
        return (
          <li key={url.href} className="flex min-w-0 flex-col gap-0.5">
            <a
              href={url.href}
              target="_blank"
              rel="noreferrer"
              title={url.href}
              className="w-fit max-w-full rounded-sm text-xs wrap-anywhere text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {source.section ?? source.title}
            </a>
            <bdi className="text-xs wrap-anywhere text-muted-foreground">
              {source.section ? source.title + " (" + url.hostname + ")" : url.hostname}
            </bdi>
          </li>
        );
      })}
    </ul>
  );
}
