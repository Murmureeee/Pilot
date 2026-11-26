// @env browser
import { cn } from "cn";
import type { JSX, ReactNode } from "react";

import { selectWorkingDirectory, useAgentStore } from "@renderer/stores/agent";
import { useReviewStore } from "@renderer/stores/review";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";
import type { PromptMention } from "@shared/contract";

export function InlineWorkspaceReference({
  path,
  kind,
  line,
  workingDirectory,
  previewable = true,
  chip,
  children,
}: {
  path: string;
  kind: PromptMention["type"];
  line?: number;
  workingDirectory?: string;
  previewable?: boolean;
  chip?: boolean;
  children: ReactNode;
}): JSX.Element {
  const sessionId = useAgentStore((state) => state.sessionId);
  const directory = useAgentStore(selectWorkingDirectory);
  const className = cn(
    "workspace-reference",
    chip ? "workspace-reference-chip" : "workspace-reference-link",
  );
  const title = line ? path + ":" + line : path;
  if (!previewable || kind === "skill" || !sessionId || !directory) {
    return (
      <span className={className} title={title} data-reference-kind={kind}>
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={title}
      data-reference-kind={kind}
      onClick={(event) => {
        const { composerId } = useAgentStore.getState();
        if (!composerId) return;
        useWorkspaceReferenceStore.getState().open({
          sessionId,
          path,
          kind,
          line,
          workingDirectory: workingDirectory ?? directory,
        });
        useReviewStore.getState().show(composerId, "files", event.currentTarget);
      }}
    >
      {children}
    </button>
  );
}
