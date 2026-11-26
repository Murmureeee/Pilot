// @env browser
import { ArrowLeftIcon } from "lucide-react";
import { useLayoutEffect, useRef, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";

export function DiscoveryHeading({
  title,
  back,
  onBack,
}: {
  title: string;
  back: string;
  onBack(): void;
}): JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => heading.current?.focus(), []);
  return (
    <div className="grid min-w-0 gap-2">
      <Button size="sm" variant="ghost" className="w-fit" onClick={onBack}>
        <ArrowLeftIcon data-icon="inline-start" /> {back}
      </Button>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-base font-semibold focus-visible:ring-2 focus-visible:ring-ring"
      >
        {title}
      </h2>
    </div>
  );
}
