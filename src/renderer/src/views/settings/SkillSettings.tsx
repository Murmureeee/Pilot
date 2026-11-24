// @env browser
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { SkillMeta } from "@shared/contract";
import type { ImportReport } from "@shared/imports";

import { SkillDetailsDialog } from "./SkillDetailsDialog";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SkillSettings({
  composerId,
  workingDirectory,
}: {
  composerId: string;
  workingDirectory: string | null;
}): JSX.Element {
  const locale = useLocale();
  const [skills, setSkills] = useState<SkillMeta[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<SkillMeta | null>(null);
  const [open, setOpen] = useState(false);
  const importButton = useRef<HTMLButtonElement>(null);
  const detailButton = useRef<HTMLButtonElement>(null);

  const run = async (action: () => Promise<SkillMeta[] | null>): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      const next = await action();
      if (next !== null) setSkills(next);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  };

  useEffect(() => {
    let current = true;
    void window.pi.skillsList(composerId).then(
      (next) => {
        if (current) setSkills(next);
      },
      (cause: unknown) => {
        if (current) setError(messageOf(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [composerId]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={importButton}
          size="sm"
          disabled={pending}
          onClick={() => void run(() => window.pi.skillsImport(locale, composerId))}
        >
          <PlusIcon data-icon="inline-start" /> {t("导入技能目录", locale)}
        </Button>
        <ExternalImportDialog
          kind="skill"
          label="从 Codex 或 Claude Code 导入"
          locale={locale}
          workingDirectory={workingDirectory}
          onImported={(next) => {
            setReport(next);
            void run(() => window.pi.skillsList(composerId));
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void run(async () => {
              if (await window.pi.openPath("skills")) throw new Error("无法打开技能目录。");
              return null;
            })
          }
        >
          <FolderOpenIcon data-icon="inline-start" /> {t("打开技能目录", locale)}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      <ExternalImportResult report={report} locale={locale} />
      <div className="settings-list">
        {skills?.length === 0 && (
          <ListEmpty
            title={t("还没有技能", locale)}
            description={t("导入含 SKILL.md 的目录，启用后从下一次请求开始生效。", locale)}
          />
        )}
        {skills?.map((skill) => (
          <div key={skill.id} className="settings-row flex-nowrap gap-x-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium wrap-anywhere">{skill.name}</p>
              {skill.description && (
                <p
                  className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted-foreground"
                  title={skill.description}
                >
                  {skill.description}
                </p>
              )}
              <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
                {skill.source === "installed"
                  ? t("本机安装", locale)
                  : t("项目技能（{0}）", locale, [skill.source])}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {skill.source === "installed" && (
                <Switch
                  aria-label={skill.name}
                  checked={skill.enabled}
                  disabled={pending}
                  onCheckedChange={(checked) =>
                    void run(() => window.pi.skillsToggle(composerId, skill.id, checked))
                  }
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("查看技能 {0}", locale, [skill.name])}
                onClick={(event) => {
                  detailButton.current = event.currentTarget;
                  setTarget(skill);
                  setOpen(true);
                }}
              >
                {t("查看", locale)}
              </Button>
            </div>
          </div>
        ))}
      </div>
      {target && (
        <SkillDetailsDialog
          key={target.directory}
          composerId={composerId}
          skill={target}
          open={open}
          onClose={() => setOpen(false)}
          finalFocus={() =>
            detailButton.current?.isConnected ? detailButton.current : importButton.current
          }
          onDeleted={(next) => {
            setSkills(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
