// @env browser
import { Toast } from "@base-ui/react/toast";
import { cn } from "cn";
import { CheckIcon, CircleAlertIcon, XIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";

export function FeedbackBar(): JSX.Element | null {
  const locale = useLocale();
  const { toasts } = Toast.useToastManager();
  if (toasts.length === 0) return null;
  const close = t("关闭提示", locale);

  return (
    <Toast.Viewport
      aria-label={t("通知", locale)}
      className="z-10 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      data-feedback-bar
    >
      {toasts.map((toast) => {
        const failed = toast.type === "error";
        const Icon = failed ? CircleAlertIcon : CheckIcon;
        return (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="flex min-w-0 items-start gap-2 border-b border-border/65 bg-background px-3 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-ending-style:hidden data-limited:hidden"
          >
            <Toast.Content className="flex min-w-0 flex-1 items-start gap-2 py-1">
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  failed ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
                )}
              />
              <div className="min-w-0">
                <Toast.Title
                  className={cn(
                    "text-sm font-medium wrap-anywhere",
                    failed ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
                  )}
                />
                {toast.description && (
                  <Toast.Description className="max-h-16 overflow-y-auto text-xs wrap-anywhere text-muted-foreground" />
                )}
              </div>
            </Toast.Content>
            <Toast.Close
              aria-hidden={false}
              render={<Button variant="ghost" size="icon-xs" aria-label={close} title={close} />}
            >
              <XIcon aria-hidden="true" />
            </Toast.Close>
          </Toast.Root>
        );
      })}
    </Toast.Viewport>
  );
}
