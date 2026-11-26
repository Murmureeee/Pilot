// @env browser
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { PERMISSION_ATTENTION_TEXT } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { McpOAuthInfo, McpOAuthRef } from "@shared/mcp";

export function McpOAuthControl({
  info,
  name,
  composerId,
  onChanged,
}: {
  info: McpOAuthInfo;
  name: string;
  composerId?: string;
  onChanged(): void;
}): JSX.Element {
  const locale = useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const request = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const target: McpOAuthRef = { id: info.id, revision: info.revision, composerId };
  const needsLogin = info.status === "required";
  const signedIn = info.status === "signed-in";
  const signInLabel = info.hasCredentials ? "重新登录…" : "登录…";

  useEffect(
    () => () => {
      if (request.current) void window.pi.mcpOAuthCancel(request.current).catch(() => {});
      request.current = undefined;
    },
    [info.revision, composerId],
  );

  const close = (): void => {
    if (request.current) void window.pi.mcpOAuthCancel(request.current).catch(() => {});
    request.current = undefined;
    setWaiting(false);
    setOpen(false);
  };

  const displayError = (cause: unknown): string =>
    localizeError(cause instanceof Error ? cause.message : String(cause), locale);

  const signIn = async (): Promise<void> => {
    if (request.current) return;
    const id = crypto.randomUUID();
    request.current = id;
    setWaiting(true);
    setError("");
    try {
      const authorized = await window.pi.mcpOAuthStart(target, id, locale);
      if (request.current !== id) return;
      setOpen(false);
      if (authorized) onChanged();
    } catch (cause) {
      if (request.current === id) setError(displayError(cause));
    } finally {
      if (request.current === id) {
        request.current = undefined;
        setWaiting(false);
      }
    }
  };

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    setError("");
    try {
      await window.pi.mcpOAuthSignOut(target);
      setOpen(false);
      onChanged();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div
      data-mcp-oauth-status={info.status}
      className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
    >
      {needsLogin && (
        <p className={"text-xs " + PERMISSION_ATTENTION_TEXT}>
          {t(info.hasCredentials ? "需要重新登录" : "需要登录", locale)}
        </p>
      )}
      {signedIn && <p className="text-xs text-muted-foreground">{t("已登录", locale)}</p>}
      <Button
        ref={trigger}
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setError("");
          setOpen(true);
          if (!signedIn) void signIn();
        }}
      >
        {t(signedIn ? "管理登录…" : signInLabel, locale)}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !signingOut) close();
        }}
      >
        {open && (
          <DialogContent
            data-mcp-oauth-dialog
            showCloseButton={false}
            finalFocus={trigger}
            className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto overscroll-contain"
          >
            <DialogHeader>
              <DialogTitle>{t("MCP 登录", locale)}</DialogTitle>
              <DialogDescription className="wrap-anywhere">
                {name}
                <bdi className="block font-mono text-xs">{info.origin}</bdi>
              </DialogDescription>
            </DialogHeader>
            {waiting && (
              <p role="status" className="text-sm text-muted-foreground">
                {t("请在系统浏览器完成授权，然后返回 Pilot。", locale)}
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs wrap-anywhere text-destructive">
                {error}
              </p>
            )}
            <DialogFooter className="flex-row flex-wrap justify-end gap-2">
              {info.hasCredentials && !waiting && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={signingOut}
                  onClick={() => void signOut()}
                >
                  {t("退出登录", locale)}
                </Button>
              )}
              <Button type="button" variant="outline" disabled={signingOut} onClick={close}>
                {t(waiting ? "取消登录" : "关闭", locale)}
              </Button>
              {!waiting && (
                <Button type="button" disabled={signingOut} onClick={() => void signIn()}>
                  {t(info.hasCredentials ? "重新登录" : "在浏览器中登录", locale)}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
