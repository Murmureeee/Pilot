// @env browser
import type { JSX } from "react";
import { ChevronRightIcon, FileDiffIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import { t, useLocale } from "@renderer/lib/i18n";
import type { FileChangeNode, FileChangesReview } from "@renderer/lib/types";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { cn } from "cn";
import { DiffStats } from "./diff-stats";
import { FileDiffPreview } from "./file-diff-preview";

function ChangedFile({
  node,
  review,
  busy,
}: {
  node: Extract<FileChangeNode, { kind: "file" }>;
  review: FileChangesReview;
  busy: boolean;
}): JSX.Element {
  const locale = useLocale();
  const { change, name } = node;
  const expanded = review.expanded.includes(change.id);
  const headerId = "change-file-" + change.id;
  const contentId = headerId + "-diff";

  return (
    <li
      className={cn(
        "min-w-0 overflow-hidden rounded-md",
        expanded && "border-border/80 bg-card border",
      )}
    >
      <Button
        id={headerId}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={expanded ? contentId : undefined}
        title={change.path}
        onClick={() => useFileChangesStore.getState().toggleFile(change.id)}
        className={cn(
          "h-8 w-full min-w-0 justify-start gap-1.5 rounded-md px-1.5 text-left font-normal",
          expanded && "bg-muted/55 rounded-b-none",
        )}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <FileDiffIcon aria-hidden="true" className="text-muted-foreground size-3.5" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{name}</span>
        {change.reverted ? (
          <span className="text-muted-foreground shrink-0 text-xs">{t("已撤销", locale)}</span>
        ) : (
          change.stats && <DiffStats stats={change.stats} />
        )}
      </Button>
      {expanded && (
        <div id={contentId} aria-labelledby={headerId}>
          <FileDiffPreview
            sessionId={review.sessionId}
            change={change}
            busy={busy}
            confirming={review.undoChangeId === change.id}
          />
        </div>
      )}
    </li>
  );
}

export function FileChangesTree({
  entries,
  review,
  busy,
}: {
  entries: readonly FileChangeNode[];
  review: FileChangesReview;
  busy: boolean;
}): JSX.Element {
  return (
    <ul className="grid min-w-0 gap-0.5">
      {entries.map((node) => {
        if (node.kind === "file")
          return <ChangedFile key={node.change.id} node={node} review={review} busy={busy} />;
        const expanded = !review.collapsedFolders.includes(node.path);
        const Icon = expanded ? FolderOpenIcon : FolderIcon;
        return (
          <Collapsible
            key={"folder-" + node.path}
            render={<li />}
            open={expanded}
            onOpenChange={(open) => useFileChangesStore.getState().setFolderOpen(node.path, open)}
            className="min-w-0"
          >
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" />}
              data-change-folder={node.path}
              title={node.path}
              className="text-muted-foreground h-8 w-full min-w-0 justify-start gap-1.5 rounded-md px-1.5 text-left font-normal"
            >
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  expanded && "rotate-90",
                )}
              />
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="truncate">{node.name}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="border-border ms-3 min-w-0 border-s ps-2">
              <FileChangesTree entries={node.children} review={review} busy={busy} />
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </ul>
  );
}
