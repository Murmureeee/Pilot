// @env browser
import { cn } from "cn";
import {
  CheckIcon,
  ChevronRightIcon,
  FileDiffIcon,
  FilePlusIcon,
  FolderIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@renderer/components/ui/input-group";
import { fileChangesTree, filterFileChanges } from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import type { FileChangeNode, FileChangesReview } from "@renderer/lib/types";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type { FileChangeSummary } from "@shared/contract";

import { DiffStats } from "./diff-stats";

function FileChangesTree({
  entries,
  review,
  filtering,
  onSelect,
}: {
  entries: readonly FileChangeNode[];
  review: FileChangesReview;
  filtering: boolean;
  onSelect(change: FileChangeSummary): void;
}): JSX.Element {
  return (
    <ul className="grid min-w-0 gap-px">
      {entries.map((node) => {
        if (node.kind === "file") {
          const { change } = node;
          const selected = review.selectedId === change.id;
          const Icon = change.kind === "created" ? FilePlusIcon : FileDiffIcon;
          return (
            <li key={change.id} className="min-w-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-change-navigation={change.id}
                aria-current={selected ? "true" : undefined}
                title={change.path}
                onClick={() => onSelect(change)}
                className={cn(
                  "h-7 w-full min-w-0 justify-start gap-1.5 rounded-md px-1.5 text-left text-xs font-normal",
                  selected && "bg-sidebar-accent",
                )}
              >
                <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{node.name}</span>
                {change.stats && !change.reverted && <DiffStats stats={change.stats} />}
                {selected && <CheckIcon aria-hidden="true" className="size-3" />}
              </Button>
            </li>
          );
        }
        return (
          <Collapsible
            key={"folder-" + node.path}
            render={<li />}
            {...(filtering
              ? { defaultOpen: true }
              : {
                  open: !review.collapsedFolders.includes(node.path),
                  onOpenChange: (open: boolean) =>
                    useFileChangesStore.getState().setFolderOpen(node.path, open),
                })}
            className="min-w-0"
          >
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" />}
              data-change-folder={node.path}
              title={node.path}
              className="group h-7 w-full min-w-0 justify-start gap-1.5 rounded-md px-1.5 text-left text-xs font-normal text-muted-foreground aria-expanded:bg-transparent aria-expanded:hover:bg-sidebar-accent/65"
            >
              <ChevronRightIcon
                aria-hidden="true"
                className="size-3 transition-transform group-aria-expanded:rotate-90 motion-reduce:transition-none"
              />
              <FolderIcon aria-hidden="true" className="size-3.5" />
              <span className="truncate">{node.name}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="ms-2.5 min-w-0 border-s border-border ps-1.5">
              <FileChangesTree
                entries={node.children}
                review={review}
                filtering={filtering}
                onSelect={onSelect}
              />
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </ul>
  );
}

export function FileChangesNavigator({
  id,
  changes,
  review,
  wide,
  onSelect,
}: {
  id: string;
  changes: readonly FileChangeSummary[];
  review: FileChangesReview;
  wide: boolean;
  onSelect(change: FileChangeSummary): void;
}): JSX.Element {
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const entries = useMemo(
    () => fileChangesTree(filterFileChanges(changes, normalizedQuery)),
    [changes, normalizedQuery],
  );
  const scroll = useRef<HTMLDivElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const { jump, selectedId } = review;

  useLayoutEffect(() => {
    const viewport = scroll.current;
    if (!viewport || !selectedId) return;
    const row = viewport.querySelector('[data-change-navigation="' + CSS.escape(selectedId) + '"]');
    if (!row) return;
    const item = row.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    if (item.top < bounds.top) viewport.scrollTop += item.top - bounds.top;
    if (item.bottom > bounds.bottom) viewport.scrollTop += item.bottom - bounds.bottom;
  }, [jump, selectedId]);

  return (
    <nav
      id={id}
      data-file-changes-navigator
      aria-label={t("变更文件目录", locale)}
      className={cn(
        "flex min-h-0 min-w-0 flex-col border-border/75 bg-sidebar",
        wide ? "order-last border-s" : "order-first max-h-48 border-b",
      )}
    >
      <div className="shrink-0 border-b border-border/65 p-2">
        <InputGroup className="h-8 rounded-lg bg-background">
          <InputGroupAddon className="ps-2">
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={filter}
            aria-label={t("筛选文件", locale)}
            placeholder={t("筛选文件…", locale)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
            className="text-xs"
          />
          {query && (
            <InputGroupAddon align="inline-end" className="pe-1">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={t("清除筛选", locale)}
                onClick={() => {
                  setQuery("");
                  filter.current?.focus();
                }}
              >
                <XIcon aria-hidden="true" />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <div
        ref={scroll}
        data-file-changes-tree-scroll
        className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-x-hidden overflow-y-auto overscroll-contain p-1.5"
      >
        {entries.length ? (
          <FileChangesTree
            key={normalizedQuery}
            entries={entries}
            review={review}
            filtering={Boolean(normalizedQuery)}
            onSelect={onSelect}
          />
        ) : (
          <p role="status" className="px-1.5 py-2 text-xs text-muted-foreground">
            {t("没有匹配的文件", locale)}
          </p>
        )}
      </div>
    </nav>
  );
}
