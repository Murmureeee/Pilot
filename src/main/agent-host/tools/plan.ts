// @env node
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { arr, compile, obj, oneOf, str } from "@earendil-works/pi-schema";

import { PLAN_PROPOSAL_MAX_LENGTH } from "../../../shared/constants";
import { PLAN_STATUSES, type PlanStep } from "../../../shared/contract";
import { PLAN_TOOL_NAME, PROPOSE_PLAN_TOOL_NAME, TOOL_LABELS } from "./constants";

const planParams = obj({
  steps: arr(
    obj({
      title: str({ minLength: 1, maxLength: 200 }),
      status: oneOf(PLAN_STATUSES),
    }),
    { minItems: 1, maxItems: 12, description: "The complete ordered list of steps." },
  ),
});

const schema = compile(planParams);

export const planTool: AgentTool<typeof planParams> = {
  name: PLAN_TOOL_NAME,
  label: TOOL_LABELS[PLAN_TOOL_NAME],
  description:
    "For a multi-step task, publish the complete plan before starting work. Update the full list as steps progress, and mark a step completed only when it is done. Skip planning for simple requests.",
  parameters: planParams,
  executionMode: "sequential",
  execute: async (_id, params): Promise<AgentToolResult> => {
    const steps = params.steps.map(({ title, status }) => ({ title: title.trim(), status }));
    if (steps.some((step) => !step.title)) throw new Error("Plan steps need a title.");
    return { content: [{ type: "text", text: "Plan updated." }], details: { steps } };
  },
};

export function readPlanSteps(details: unknown): PlanStep[] | undefined {
  return schema.check(details) ? details.steps : undefined;
}

const proposalParams = obj({
  markdown: str({ minLength: 1, maxLength: PLAN_PROPOSAL_MAX_LENGTH }),
});

const proposalSchema = compile(proposalParams);

export const proposePlanTool: AgentTool<typeof proposalParams> = {
  name: PROPOSE_PLAN_TOOL_NAME,
  label: TOOL_LABELS[PROPOSE_PLAN_TOOL_NAME],
  description: "Submit the complete Markdown implementation plan for the user's review in Pilot.",
  parameters: proposalParams,
  executionMode: "sequential",
  execute: async (_id, params): Promise<AgentToolResult> => {
    const markdown = params.markdown.trim();
    if (!markdown) throw new Error("The proposed plan is empty.");
    return { content: [{ type: "text", text: markdown }], details: { markdown } };
  },
};

export function readPlanProposal(details: unknown): string | undefined {
  return proposalSchema.check(details) ? details.markdown.trim() || undefined : undefined;
}
