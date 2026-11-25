// @env browser
import { Toast } from "@base-ui/react/toast";

import { currentLocale, localizeError, t } from "./i18n";

export const feedback = Toast.createToastManager();

export function showFeedback(message: string): void {
  feedback.add({ title: t(message, currentLocale()), type: "success" });
}

export function showFeedbackError(message: string, cause: unknown): void {
  const locale = currentLocale();
  const reason = cause instanceof Error ? cause.message : String(cause);
  feedback.add({
    title: t(message, locale),
    description: localizeError(reason, locale),
    type: "error",
    priority: "high",
  });
}
