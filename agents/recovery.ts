import { z } from "zod";
import { differenceInCalendarDays } from "date-fns";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef, ToolDef } from "./runtime/types";
import { getDoctor, getPatient, toolToday } from "./tools";
import {
  rankRecoveryOptions,
  rankWaitlistCandidates,
  type WaitlistCandidateInput,
} from "@/core/ranking";
import { dayLoad } from "@/core/scheduling";
import { demoNow } from "@/core/clock";
import {
  RecoveryOptionSchema,
  SlotSchema,
  type RecoveryOption,
  type Slot,
} from "@/core/types";
import { id as newId } from "@/core/ids";

// ---------------------------------------------------------------------------
// Reschedule planning
// ---------------------------------------------------------------------------

export const RecoveryItemInputSchema = z.object({
  appointmentId: z.string(),
  patientId: z.string(),
  patientName: z.string(),
  type: z.enum(["routine", "follow_up", "urgent"]),
  originalDoctorId: z.string(),
  originalStartUtc: z.string(),
  options: z.array(SlotSchema),
  priorityRank: z.number().int(),
  priorityReason: z.string(),
});
export type RecoveryItemInput = z.infer<typeof RecoveryItemInputSchema>;

export interface RecoveryInput {
  caseId: string;
  items: RecoveryItemInput[];
}

export const RecoveryPlanSchema = z.object({
  appointmentId: z.string(),
  chosenOptionId: z.string(),
  options: z.array(RecoveryOptionSchema).max(8),
  rationale: z.string().max(700),
  /** Required if chosenOptionId is not the top-ranked option. */
  reorderReason: z
    .string()
    .max(350)
    .nullish()
    .transform((v) => v ?? undefined),
});

export const RecoveryResultSchema = z.object({
  plans: z.array(RecoveryPlanSchema).max(30),
  summary: z.string().max(600),
});
export type RecoveryResult = z.infer<typeof RecoveryResultSchema>;

/** Deterministic scorer exposed as a tool: the LLM sees scored options, never raw math. */
function scoreItem(item: RecoveryItemInput): RecoveryOption[] {
  const patient = getPatient(item.patientId);
  const withNames = item.options.map((o) => ({
    ...o,
    doctorName: getDoctor(o.doctorId).name,
  }));
  const scored = rankRecoveryOptions(
    {
      type: item.type,
      originalDoctorId: item.originalDoctorId,
      originalStartUtc: item.originalStartUtc,
      patientPrefDayPart: patient.prefDayPart,
      patientPreferredDoctorId: patient.preferredDoctorId,
      dayLoad: (slot: Slot) => dayLoad(slot.doctorId, slot.day),
    },
    withNames,
  );
  return scored.slice(0, 5).map((s, i) => ({
    id: `opt_${newId(8)}`,
    doctorId: s.slot.doctorId,
    doctorName: getDoctor(s.slot.doctorId).name,
    startUtc: s.slot.startUtc,
    endUtc: s.slot.endUtc,
    block: s.slot.block,
    day: s.slot.day,
    score: s.score,
    dots: s.dots,
    chips: s.chips,
    rank: i + 1,
  }));
}

const toolRankOptions: ToolDef = {
  name: "rank_recovery_options",
  description:
    "Deterministically score and rank validated slot options using soonness, patient preference, continuity, waiting-time fairness, and a small near-capacity penalty. Returns ranked options with per-factor chips. You may not silently reorder these: choosing a non-top option requires a stated reorderReason.",
  schema: z.object({ appointmentId: z.string() }),
  run: async () => ({ error: "bound at runtime" }),
};

function rationaleFor(item: RecoveryItemInput, top: RecoveryOption): string {
  const topChips = top.chips
    .filter((c) => c.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map((c) => c.label.toLowerCase());
  return `${item.patientName}'s ${item.type.replace("_", "-")} moves to ${top.doctorName}: ${topChips.join(", ")}. ${item.priorityReason}.`;
}

async function deterministicRecovery(
  input: RecoveryInput,
): Promise<RecoveryResult> {
  const plans = input.items.map((item) => {
    const options = scoreItem(item);
    const top = options[0];
    if (!top) {
      return {
        appointmentId: item.appointmentId,
        chosenOptionId: "none",
        options: [],
        rationale: `No validated options were available for ${item.patientName}; escalating to staff for manual handling.`,
      };
    }
    return {
      appointmentId: item.appointmentId,
      chosenOptionId: top.id,
      options,
      rationale: rationaleFor(item, top),
    };
  });
  const withOptions = plans.filter((p) => p.options.length > 0).length;
  return {
    plans,
    summary: `Ranked recovery plans for ${input.items.length} patient${input.items.length === 1 ? "" : "s"} (${withOptions} with validated options). Deterministic scorer; top option pre-selected for staff review.`,
  };
}

export const recoveryAgent: AgentDef<RecoveryInput, RecoveryResult> = {
  name: "recovery",
  feedVerb: (i) =>
    `Ranking recovery options for ${i.items.length} patient${i.items.length === 1 ? "" : "s"}`,
  system: `You are SchediCare's Recovery agent.
For each affected appointment, call rank_recovery_options to get the deterministic ranking, then package a plan: keep the returned options and scores EXACTLY as ranked, pick chosenOptionId (normally rank 1 — if you deviate, you MUST provide reorderReason grounded in the assessment context), and write a 1-2 sentence rationale that cites the top scoring factors and the patient's priority reason. Never invent times, scores, or chips. Finish with submit_result covering every appointment given.`,
  tools: [toolToday, toolRankOptions],
  resultSchema: RecoveryResultSchema as unknown as z.ZodType<RecoveryResult>,
  maxSteps: 16,
  buildPrompt: (i) =>
    `Case ${i.caseId}. Package recovery plans for:\n` +
    i.items
      .map(
        (it) =>
          `- ${it.appointmentId}: ${it.patientName}, ${it.type}, priority #${it.priorityRank} (${it.priorityReason}), ${it.options.length} validated options`,
      )
      .join("\n") +
    `\nCall rank_recovery_options per appointment, then submit_result.`,
  fallback: async (i) => deterministicRecovery(i),
};

export function runRecovery(input: RecoveryInput, ctx: AgentCtx) {
  // Bind the ranking tool to this input so the live agent sees real data.
  const bound: AgentDef<RecoveryInput, RecoveryResult> = {
    ...recoveryAgent,
    tools: recoveryAgent.tools.map((t) =>
      t.name === "rank_recovery_options"
        ? {
            ...t,
            run: async (args: { appointmentId: string }) => {
              const item = input.items.find(
                (x) => x.appointmentId === args.appointmentId,
              );
              if (!item)
                throw new Error(
                  `appointment ${args.appointmentId} not in this case`,
                );
              return scoreItem(item);
            },
          }
        : t,
    ),
  };
  return runAgent(bound, input, ctx);
}

// ---------------------------------------------------------------------------
// Waitlist backfill for a vacated slot
// ---------------------------------------------------------------------------

export const WaitlistFillResultSchema = z.object({
  chosenWaitlistId: z.string(),
  candidates: z
    .array(
      z.object({
        waitlistId: z.string(),
        patientId: z.string(),
        patientName: z.string(),
        score: z.number(),
        dots: z.number().int(),
        chips: z.array(z.object({ label: z.string(), pts: z.number() })),
        rank: z.number().int(),
      }),
    )
    .max(8),
  rationale: z.string().max(600),
});
export type WaitlistFillResult = z.infer<typeof WaitlistFillResultSchema>;

export interface WaitlistFillInput {
  caseId: string;
  slot: Slot;
  slotType: "routine" | "follow_up" | "urgent";
  vacatedAppointmentId: string;
  candidates: WaitlistCandidateInput[];
}

function deterministicWaitlist(input: WaitlistFillInput): WaitlistFillResult {
  const ranked = rankWaitlistCandidates(
    input.slot,
    input.slotType,
    demoNow(),
    input.candidates,
  ).slice(0, 5);
  const withRank = ranked.map((r, i) => ({
    waitlistId: r.waitlistId,
    patientId: r.patientId,
    patientName: r.patientName,
    score: r.score,
    dots: r.dots,
    chips: r.chips,
    rank: i + 1,
  }));
  const top = withRank[0];
  if (!top) {
    return {
      chosenWaitlistId: "none",
      candidates: [],
      rationale: "No matching waitlist candidates for this slot type.",
    };
  }
  const wait = input.candidates.find((c) => c.waitlistId === top.waitlistId);
  const days = wait
    ? Math.max(0, differenceInCalendarDays(demoNow(), new Date(wait.addedAt)))
    : 0;
  return {
    chosenWaitlistId: top.waitlistId,
    candidates: withRank,
    rationale: `${top.patientName} best fits the vacated ${input.slot.block.toUpperCase()} slot: ${top.chips
      .filter((c) => c.pts > 0)
      .slice(0, 2)
      .map((c) => c.label.toLowerCase())
      .join(
        ", ",
      )} (waiting ${days} days). Offer goes out only after staff approval.`,
  };
}

export const waitlistAgent: AgentDef<WaitlistFillInput, WaitlistFillResult> = {
  name: "recovery",
  feedVerb: (i) =>
    `Ranking waitlist candidates for the vacated ${i.slot.block.toUpperCase()} slot`,
  system: `You are SchediCare's Recovery agent handling waitlist backfill for one vacated slot.
Call rank_waitlist_candidates for the deterministic ranking; keep it exactly as returned, pick the top candidate, and write a short rationale citing its scoring chips. Finish with submit_result.`,
  tools: [
    toolToday,
    {
      name: "rank_waitlist_candidates",
      description:
        "Deterministically rank the provided waitlist candidates for the vacated slot.",
      schema: z.object({}),
      run: async () => ({ error: "bound at runtime" }),
    },
  ],
  resultSchema: WaitlistFillResultSchema,
  maxSteps: 5,
  buildPrompt: (i) =>
    `Case ${i.caseId}. A ${i.slotType} slot ${i.slot.startUtc} (doctor ${i.slot.doctorId}) was vacated (appointment ${i.vacatedAppointmentId}). ${i.candidates.length} waitlist candidates. Rank them and submit the fill plan.`,
  fallback: async (i) => deterministicWaitlist(i),
};

export function runWaitlistFill(input: WaitlistFillInput, ctx: AgentCtx) {
  const bound: AgentDef<WaitlistFillInput, WaitlistFillResult> = {
    ...waitlistAgent,
    tools: waitlistAgent.tools.map((t) =>
      t.name === "rank_waitlist_candidates"
        ? { ...t, run: async () => deterministicWaitlist(input).candidates }
        : t,
    ),
  };
  return runAgent(bound, input, ctx);
}
