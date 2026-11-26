// @env browser
import { FolderOpenIcon } from "lucide-react";
import { useState, type DragEvent, type JSX, type ReactNode } from "react";

import { showFeedbackError } from "@renderer/lib/feedback";
import { t, useLocale } from "@renderer/lib/i18n";

function receivesProjectDrop(event: DragEvent<HTMLDivElement>): boolean {
  const { target, currentTarget, dataTransfer } = event;
  return (
    dataTransfer.types.includes("Files") &&
    target instanceof Element &&
    currentTarget.contains(target) &&
    !target.closest(
      '[data-composer-file-drop], [role="dialog"], [role="alertdialog"], [role="menu"]',
    )
  );
}

export function ProjectDropTarget({ children }: { children: ReactNode }): JSX.Element {
  const locale = useLocale();
  const [dragging, setDragging] = useState(false);

  const drop = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    setDragging(false);
    if (!receivesProjectDrop(event)) return;
    event.preventDefault();
    try {
      const { files } = event.dataTransfer;
      if (files.length !== 1) throw new Error("请一次拖入一个项目文件夹。");
      const path = window.pi.getPathForFile(files[0]!);
      if (!path) throw new Error("拖放内容没有可用的本地路径。");
      await window.pi.sessionOpenDroppedProject(path);
    } catch (error) {
      showFeedbackError("无法打开项目。请拖入文件夹或使用「打开项目」。", error);
    }
  };

  return (
    <div
      data-project-drop-target
      className="relative flex min-w-0 flex-1 overflow-hidden rounded-xl border border-sidebar-border bg-background"
      onDragOver={(event) => {
        const accepted = receivesProjectDrop(event);
        setDragging(accepted);
        if (!accepted) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDragging(false);
      }}
      onDrop={(event) => void drop(event)}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 rounded-xl ring-2 ring-ring ring-inset">
          <p
            data-project-drop-hint
            role="status"
            className="absolute top-2 left-1/2 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1 text-sm text-popover-foreground shadow-sm"
          >
            <FolderOpenIcon className="size-4 shrink-0" aria-hidden="true" />
            {t("拖入文件夹以打开项目", locale)}
          </p>
        </div>
      )}
    </div>
  );
}
