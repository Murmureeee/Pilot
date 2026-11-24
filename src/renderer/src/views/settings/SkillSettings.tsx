// @env browser
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import {
  ExternalImportDialog,
  ExternalImportResult,
} from "@renderer/components/ai/external-import-dialog";
import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { ImportReport } from "@shared/imports";

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function SkillSettings({
  workingDirectory,
}: {
  workingDirectory: string | null;
}): JSX.Element {
  const locale = useLocale();
  const skills = useAgentStore((s) => s.skills);
  const listSkills = useAgentStore((s) => s.listSkills);
  const importSkills = useAgentStore((s) => s.importSkills);
  const toggleSkill = useAgentStore((s) => s.toggleSkill);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 选错目录（缺少 SKILL.md）等失败要就地说明原因，不能点了没反应。
  const run = (action: () => Promise<void>): void => {
    setError(null);
    action().catch((cause: unknown) => setError(messageOf(cause)));
  };

  useEffect(() => {
    listSkills().catch((cause: unknown) => setError(messageOf(cause)));
  }, [listSkills]);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run(importSkills)}>
          <PlusIcon data-icon="inline-start" /> {t("导入技能目录", locale)}
        </Button>
        <ExternalImportDialog
          kind="skill"
          label="从 Codex 或 Claude Code 导入"
          locale={locale}
          workingDirectory={workingDirectory}
          onImported={(next) => {
            setReport(next);
            run(listSkills);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            run(async () => {
              if (await window.pi.openPath("skills")) throw new Error("无法打开技能目录。");
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
        {skills.length === 0 && (
          <ListEmpty
            title={t("还没有技能", locale)}
            description={t("导入含 SKILL.md 的目录，启用后从下一次请求开始生效。", locale)}
          />
        )}
        {skills.map((skill) => (
          <div key={skill.id} className="settings-row flex-nowrap">
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
            </div>
            <Switch
              aria-label={skill.name}
              checked={skill.enabled}
              onCheckedChange={(checked) => run(() => toggleSkill(skill.id, checked))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
