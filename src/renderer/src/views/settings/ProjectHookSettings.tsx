// @env browser
import { useState, type FormEvent, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Textarea } from "@renderer/components/ui/textarea";
import { COMMAND_SHELL_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { selectProjectDirectory, useAgentStore } from "@renderer/stores/agent";
import { HOOK_COMMAND_LIMIT, HOOK_LABELS, HOOK_PHASES } from "@shared/constants";
import type { CommandShell, HookCommands, ProjectHooks } from "@shared/contract";
import { wslShellLabel } from "@shared/wsl-project";

import { SettingsGroup } from "./SettingsGroup";

export function ProjectHookSettings({
  projects,
  shell,
}: {
  projects?: Record<string, ProjectHooks>;
  shell: CommandShell;
}): JSX.Element {
  const locale = useLocale();
  const directory = useAgentStore(selectProjectDirectory);
  return (
    <SettingsGroup
      id="settings-project-hooks"
      title={t("项目钩子", locale)}
      description={t("为当前项目配置自动运行的命令。", locale)}
    >
      {directory ? (
        <HookDialog
          key={directory}
          directory={directory}
          saved={projects?.[directory]}
          shell={wslShellLabel(directory) ? "bash" : shell}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t("打开项目后可配置钩子。", locale)}</p>
      )}
    </SettingsGroup>
  );
}

function HookDialog({
  directory,
  saved,
  shell,
}: {
  directory: string;
  saved?: ProjectHooks;
  shell: CommandShell;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<HookCommands>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const shellChanged = saved !== undefined && saved.shell !== shell;
  const dirty =
    shellChanged ||
    HOOK_PHASES.some((phase) => (draft[phase] ?? "").trim() !== (saved?.commands[phase] ?? ""));

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const commands: HookCommands = {};
      for (const phase of HOOK_PHASES) {
        const command = draft[phase]?.trim();
        if (command) commands[phase] = command;
      }
      const settings = await window.pi.settingsSetProjectHooks(directory, shell, commands);
      useAgentStore.setState({ settings });
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          setDraft(saved?.commands ?? {});
          setError(undefined);
        }
        setOpen(next);
      }}
    >
      <div className="settings-list">
        <div className="settings-row">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t("当前项目", locale)}</div>
            <div className="mt-0.5 text-xs wrap-anywhere text-muted-foreground">{directory}</div>
          </div>
          <DialogTrigger render={<Button size="sm" variant="outline" />}>
            {t("配置钩子…", locale)}
          </DialogTrigger>
        </div>
      </div>
      <DialogContent
        closeLabel={t("关闭", locale)}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("项目钩子", locale)}</DialogTitle>
          <DialogDescription>
            {t("保存后，命令将在当前项目的后续执行回合中自动运行。", locale)}
          </DialogDescription>
          <p className="text-xs wrap-anywhere text-muted-foreground">{directory}</p>
          <p className="text-xs text-muted-foreground">
            {wslShellLabel(directory) ?? COMMAND_SHELL_LABELS[shell]}
          </p>
        </DialogHeader>
        <form className="grid min-w-0 gap-4" onSubmit={(event) => void save(event)}>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("清空一项可停用该钩子。调用前钩子失败会拦截工具。只读和计划模式跳过钩子。", locale)}
          </p>
          {shellChanged && (
            <output className="text-xs text-amber-700 dark:text-amber-400">
              {t("命令环境已更改。核对命令并保存后，钩子会重新启用。", locale)}
            </output>
          )}
          {HOOK_PHASES.map((phase) => (
            <div key={phase} className="grid gap-1.5">
              <label htmlFor={"project-hook-" + phase} className="text-sm font-medium">
                {t(HOOK_LABELS[phase], locale)}
              </label>
              <Textarea
                id={"project-hook-" + phase}
                className="min-h-16 font-mono"
                rows={2}
                maxLength={HOOK_COMMAND_LIMIT}
                value={draft[phase] ?? ""}
                disabled={saving}
                onChange={(event) => setDraft({ ...draft, [phase]: event.target.value })}
              />
            </div>
          ))}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {localizeError(error, locale)}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" disabled={saving} />}>
              {t("取消", locale)}
            </DialogClose>
            <Button type="submit" disabled={!dirty || saving}>
              {t(saving ? "保存中…" : "保存", locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
