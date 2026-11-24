// @env node
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { obj, opt, str } from "@earendil-works/pi-schema";

import type { SkillMeta } from "@shared/contract";

import { SKILL_UNAVAILABLE } from "../constants";
import { readSkillFile } from "../skills";
import { READ_SKILL_TOOL_NAME, TOOL_LABELS } from "./constants";

const parameters = obj({
  skillId: str({
    description: "The exact skillId from the current catalogue or message selection.",
  }),
  path: opt(
    str({ description: "File path relative to the skill directory. Defaults to SKILL.md." }),
  ),
});

export function createReadSkillTool(
  availableSkill: (id: string) => SkillMeta | undefined,
): AgentTool<typeof parameters> {
  return {
    name: READ_SKILL_TOOL_NAME,
    label: TOOL_LABELS[READ_SKILL_TOOL_NAME],
    description: "Read an available skill's SKILL.md or a bundled UTF-8 file inside that skill.",
    parameters,
    execute: async (_id, args): Promise<AgentToolResult> => {
      const skill = availableSkill(args.skillId);
      if (!skill) throw new Error(SKILL_UNAVAILABLE);
      return { content: [{ type: "text", text: readSkillFile(skill, args.path) }], details: {} };
    },
  };
}
