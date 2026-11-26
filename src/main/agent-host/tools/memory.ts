// @env node
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { compile, obj, oneOf, opt, str } from "@earendil-works/pi-schema";

import { MEMORY_TEXT_LIMIT } from "../../../shared/constants";
import type { MemoryProposal } from "../../../shared/contract";
import { MEMORY_TEXT_REQUIRED } from "../constants";
import { PROPOSE_MEMORY_TOOL_NAME, TOOL_LABELS } from "./constants";

const params = obj({
  text: str({
    minLength: 1,
    maxLength: MEMORY_TEXT_LIMIT,
    description: "A concise, reusable instruction in the user's language.",
  }),
  scope: opt(oneOf(["project", "global"])),
});
const schema = compile(params);

export const proposeMemoryTool: AgentTool<typeof params> = {
  name: PROPOSE_MEMORY_TOOL_NAME,
  label: TOOL_LABELS[PROPOSE_MEMORY_TOOL_NAME],
  description:
    "When the user explicitly asks you to remember a convention for later chats, propose the exact text for their review. Set scope if they named a project or global scope. Saving requires their confirmation in Pilot.",
  parameters: params,
  executionMode: "sequential",
  execute: async (_id, input): Promise<AgentToolResult> => {
    const proposal = readMemoryProposal(input);
    if (!proposal) throw new Error(MEMORY_TEXT_REQUIRED);
    return {
      content: [
        {
          type: "text",
          text: "The memory proposal is ready. Ask the user to review and save it in Pilot.",
        },
      ],
      details: { text: proposal.text, ...(proposal.scope && { scope: proposal.scope }) },
    };
  },
};

export function readMemoryProposal(details: unknown): MemoryProposal | undefined {
  if (!schema.check(details)) return;
  const text = details.text.trim();
  if (text && !text.includes("\0")) return { text, scope: details.scope };
}
