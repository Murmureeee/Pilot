// @env node
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { arr, compile, obj, oneOf, str } from "@earendil-works/pi-schema";
import { PLAN_STATUSES, type PlanStep } from "../../../shared/contract";
import { PLAN_TOOL_NAME, TOOL_LABELS } from "./constants";

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
