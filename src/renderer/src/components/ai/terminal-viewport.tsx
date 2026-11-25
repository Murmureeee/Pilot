// @env browser
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";

import { Button } from "@renderer/components/ui/button";
import { DEFAULT_TERMINAL_SIZE, TERMINAL_SCROLLBACK } from "@renderer/lib/constants";
import { showFeedbackError } from "@renderer/lib/feedback";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { isTerminalShortcut } from "@renderer/lib/window-shortcuts";
import type { TerminalOutput, TerminalRecord } from "@shared/contract";

import "@xterm/xterm/css/xterm.css";

function terminalTheme(element: HTMLElement): ITheme {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return {};
  const style = getComputedStyle(element);
  const color = (name: string): string => {
    ctx.fillStyle = style.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return "rgb(" + r + ", " + g + ", " + b + ")";
  };
  return {
    background: color("--background"),
    foreground: color("--foreground"),
    cursor: color(
      document.documentElement.classList.contains("dark")
        ? "--color-emerald-400"
        : "--color-emerald-700",
    ),
    selectionBackground: color("--accent"),
  };
}

export function terminalText(view: Terminal): string {
  if (view.hasSelection()) return view.getSelection();
  const buffer = view.buffer.active;
  let text = "";
  for (let index = 0; index < buffer.length; index++) {
    const line = buffer.getLine(index);
    if (!line) continue;
    const wrapped = buffer.getLine(index + 1)?.isWrapped === true;
    text += line.translateToString(!wrapped, 0, view.cols);
    if (!wrapped) text += "\n";
  }
  return text.trimEnd();
}

export function TerminalViewport({
  record,
  view,
  focus,
  onCopy,
}: {
  record: TerminalRecord;
  view: RefObject<Terminal | null>;
  focus: boolean;
  onCopy(): void;
}): JSX.Element {
  const locale = useLocale();
  const { composerId, id, source } = record;
  const interactive = source === "user" && record.status === "running";
  const element = useRef<HTMLDivElement>(null);
  const input = useRef(interactive);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const hint = useId();
  const label = t(interactive ? "终端输入" : "终端输出", locale);

  useLayoutEffect(() => {
    input.current = interactive;
    if (view.current) view.current.options.disableStdin = !interactive;
  }, [interactive, view]);

  useEffect(() => {
    const host = element.current;
    if (!host) return;
    const terminal = new Terminal({
      cols: DEFAULT_TERMINAL_SIZE.columns,
      rows: DEFAULT_TERMINAL_SIZE.rows,
      convertEol: source === "agent",
      cursorBlink: false,
      disableStdin: !input.current,
      fontFamily: getComputedStyle(host).fontFamily,
      fontSize: 13,
      lineHeight: 1.2,
      minimumContrastRatio: 4.5,
      screenReaderMode: true,
      scrollback: TERMINAL_SCROLLBACK,
      theme: terminalTheme(host),
      ...(source === "user" && navigator.userAgent.includes("Windows")
        ? { windowsPty: { backend: "conpty" } }
        : {}),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminal.element?.querySelector('[aria-live="assertive"]')?.setAttribute("aria-live", "polite");
    view.current = terminal;
    terminal.attachCustomKeyEventHandler((event) => !isTerminalShortcut(event));
    let disposed = false;
    let restoring = true;
    let offset: number | undefined;
    const pending: TerminalOutput[] = [];

    const output = ({ offset: start, data }: TerminalOutput): void => {
      if (offset === undefined) {
        pending.push({ offset: start, data });
        return;
      }
      const end = start + data.length;
      if (end <= offset) return;
      if (start > offset) terminal.reset();
      terminal.write(data.slice(Math.max(0, offset - start)));
      offset = end;
    };
    const unsubscribe = window.pi.onTerminalEvent((event) => {
      if (event.type === "output" && event.composerId === composerId && event.id === id)
        output(event.output);
    });
    // The snapshot may already include deltas sent while the request was in flight.
    void window.pi.sessionTerminalOutput(composerId, id).then(
      (snapshot) => {
        if (disposed) return;
        offset = snapshot.offset + snapshot.data.length;
        const restored = (): void => {
          if (disposed) return;
          restoring = false;
          setReady(true);
        };
        if (snapshot.data) terminal.write(snapshot.data, restored);
        else restored();
        for (const delta of pending) output(delta);
        pending.length = 0;
      },
      (error: unknown) => {
        if (disposed) return;
        unsubscribe();
        setFailure(error instanceof Error ? error.message : String(error));
      },
    );
    const write = terminal.onData((data) => {
      if (input.current && !restoring)
        void window.pi.sessionWriteTerminal(composerId, id, data).catch((error: unknown) => {
          if (!disposed) showFeedbackError("终端输入失败。请重试。", error);
        });
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      if (input.current)
        void window.pi
          .sessionResizeTerminal(composerId, id, { columns: cols, rows })
          .catch((error: unknown) => {
            if (!disposed) showFeedbackError("无法调整终端大小。请重试。", error);
          });
    });
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
      });
    });
    observer.observe(host);
    const applyTheme = (): void => {
      terminal.options.theme = terminalTheme(host);
    };
    window.addEventListener("pilot-theme-change", applyTheme);
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      unsubscribe();
      write.dispose();
      resize.dispose();
      terminal.dispose();
      view.current = null;
      window.removeEventListener("pilot-theme-change", applyTheme);
    };
  }, [attempt, composerId, id, source, view]);

  useEffect(() => {
    const field = view.current?.textarea;
    field?.setAttribute("aria-label", label);
    if (interactive) field?.setAttribute("aria-describedby", hint);
    else field?.removeAttribute("aria-describedby");
  }, [attempt, hint, interactive, label, view]);

  useEffect(() => {
    if (ready && focus) view.current?.focus();
  }, [focus, ready, view]);

  return (
    <>
      {interactive && (
        <span className="sr-only" id={hint}>
          {t("按 Ctrl+` 返回终端页签。按 Ctrl+Shift+C 复制输出。", locale)}
        </span>
      )}
      {failure && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 px-2 pb-2 text-xs text-destructive"
        >
          <span>{localizeError(failure, locale)}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setFailure(null);
              setReady(false);
              setAttempt((value) => value + 1);
            }}
          >
            {t("重试读取输出", locale)}
          </Button>
        </div>
      )}
      <div
        data-terminal-screen
        className="mx-2 mb-2 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-background px-2 py-1 focus-within:border-ring"
        onKeyDown={(event) => {
          if (isTerminalShortcut(event.nativeEvent)) return;
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "KeyC") {
            event.preventDefault();
            onCopy();
          }
          if (interactive || event.key !== "Escape") event.stopPropagation();
        }}
      >
        <div ref={element} className="min-h-0 min-w-0 flex-1 overflow-hidden font-mono" />
      </div>
    </>
  );
}
