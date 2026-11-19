// @env browser
import type { JSX } from "react";
import { Button } from "@renderer/components/ui/button";
import { LOCAL_OPENAI_PRESETS } from "@shared/providers";

export function LocalProviderPresets({ onSelect }: { onSelect(url: string): void }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {LOCAL_OPENAI_PRESETS.map(({ name, baseUrl }) => (
        <Button
          key={name}
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => onSelect(baseUrl)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
