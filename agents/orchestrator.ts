import { z } from "zod";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef, ToolDef } from "./runtime/types";
import { getCase, escalateCase } from "@/core/cases";
import { timeline } from "@/core/timeline";
import {
  assessStep,
  commsStep,
  fallbackSequence,
  nudgeStep,
  recoverStep,
  scheduleStep,
  waitlistStep,
} from "@/worker/steps";

export const OrchestratorResultSchema = z.object({
  endState: z.enum(["awaiting_approval", "escalated"]),
  summary: z.string().max(500),
});
export type OrchestratorResult = z.infer<typeof OrchestratorResultSchema>;

export interface OrchestratorInput {
  caseId: string;
  caseType: "doctor_emergency" | "confirmation" | "no_show_risk" | "slot_recovery" | "patient_cancellation";
  title: string;
  contextSummary: string;
}

function stepTools(caseId: string): ToolDef[] {
  return [
    {
      name: "run_assessment",
      description: "Assess a doctor-emergency disruption: affected appointments, operational priority order, severity. Use first for doctor_emergency cases.",
      schema: z.object({}),
      run: async () => ({ summary: await assessStep(caseId) }),
    },
    {
      name: "run_scheduling_search",
      description: "Search deterministic, rule-valid slot options for every assessed appointment. Requires run_assessment first. Optional constraint narrows the search (used for counter-proposal replans).",
      schema: z.object({
        afterTime: z.string().optional().describe("HH:mm clinic-local lower bound"),
        dayPart: z.enum(["am", "pm"]).optional(),
      }),
      run: async (args: { afterTime?: string; dayPart?: "am" | "pm" }) => ({ summary: await scheduleStep(caseId, args) }),
    },
    {
      name: "run_recovery_ranking",
      description: "Rank the validated options per patient into recovery plans (deterministic scorer). Requires run_scheduling_search first.",
      schema: z.object({}),
      run: async () => ({ summary: await recoverStep(caseId) }),
    },
    {
      name: "draft_offers_and_propose",
      description: "Draft one reschedule offer per plan and file recommendations for staff approval. Moves the case to awaiting_approval. Terminal work step for doctor_emergency.",
      schema: z.object({}),
      run: async () => ({ summary: await commsStep(caseId) }),
    },
    {
      name: "run_confirmation_nudge",
      description: "For confirmation cases: draft a confirm-nudge for the unconfirmed appointment and file it for approval.",
      schema: z.object({}),
      run: async () => ({ summary: await nudgeStep(caseId, "confirm_nudge") }),
    },
    {
      name: "run_preventive_outreach",
      description: "For no_show_risk cases: draft preventive outreach for the flagged appointment and file it for approval.",
      schema: z.object({}),
      run: async () => ({ summary: await nudgeStep(caseId, "preventive") }),
    },
    {
      name: "run_waitlist_backfill",
      description: "For slot_recovery cases: rank waitlist candidates for the vacated slot, draft the offer, file it for approval.",
      schema: z.object({}),
      run: async () => ({ summary: await waitlistStep(caseId) }),
    },
    {
      name: "escalate_to_staff",
      description: "Escalate the whole case to clinic staff with a reason. Use when a required step fails or nothing can be planned.",
      schema: z.object({ reason: z.string() }),
      run: async ({ reason }: { reason: string }) => {
        escalateCase(caseId, "orchestrator", reason);
        return { escalated: true };
      },
    },
    {
      name: "note",
      description: "Post a short status note to the live case feed.",
      schema: z.object({ text: z.string().max(200) }),
      quiet: true,
      run: async ({ text }: { text: string }) => {
        timeline(caseId, "orchestrator", "status", text);
        return { ok: true };
      },
    },
  ];
}

export function orchestratorAgentFor(input: OrchestratorInput): AgentDef<OrchestratorInput, OrchestratorResult> {
  return {
    name: "orchestrator",
    feedVerb: () => "Coordinating the response",
    system: `You are SchediCare's Orchestrator for a single outpatient clinic. You coordinate specialized agents through tools to handle a scheduling disruption case. You NEVER execute external effects — recommendations always stop at awaiting_approval for clinic staff; only staff can approve, and the executor applies effects afterwards.
Playbooks:
- doctor_emergency: run_assessment → run_scheduling_search → run_recovery_ranking → draft_offers_and_propose.
- confirmation: run_confirmation_nudge.
- no_show_risk: run_preventive_outreach.
- slot_recovery: run_waitlist_backfill.
If a tool fails twice or there is nothing actionable, escalate_to_staff with a clear reason. Use note sparingly for meaningful status updates. Finish with submit_result reflecting the case's true end state.`,
    tools: stepTools(input.caseId),
    resultSchema: OrchestratorResultSchema,
    maxSteps: 12,
    buildPrompt: (i) =>
      `Case ${i.caseId} (${i.caseType}): ${i.title}\nContext: ${i.contextSummary}\nRun the appropriate playbook now.`,
    fallback: async (i) => {
      await fallbackSequence(i.caseId);
      const state = getCase(i.caseId).state;
      return {
        endState: state === "escalated" ? "escalated" : "awaiting_approval",
        summary: `Deterministic playbook completed for ${i.caseType}; case is ${state}.`,
      };
    },
  };
}

export async function orchestrate(input: OrchestratorInput, ctx: AgentCtx) {
  const res = await runAgent(orchestratorAgentFor(input), input, ctx);
  // Trust the database over the model's claim; surface any mismatch.
  const actual = getCase(input.caseId).state;
  if (res.mode === "live" && actual !== res.output.endState && actual !== "awaiting_approval" && actual !== "escalated") {
    timeline(input.caseId, "orchestrator", "error", `Orchestrator reported ${res.output.endState} but case is ${actual}`, "Escalating for staff review.");
    escalateCase(input.caseId, "orchestrator", "Pipeline finished in an unexpected state.");
  }
  return res;
}
