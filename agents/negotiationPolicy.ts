/**
 * Negotiation policy agent: given the accumulated constraints, the offer
 * history, and the deterministic relaxation analysis, choose ONE next move
 * from a closed action set. This is the single point of open-ended agency in
 * the reply loop — everything upstream (facts) and downstream (guards, turn
 * budget, staff approval) is deterministic.
 *
 * The model may only:
 *  - offer slots BY KEY from the candidates the engine produced,
 *  - ask a clarification that targets a computed relaxation and cites ONLY
 *    the provided counts,
 *  - escalate with a reason.
 * It cannot invent times, send anything (drafts still pass the approval
 * gate), or exceed the turn budget (enforced in core/negotiations.ts).
 * Fallback when AI is down: escalate — the loop degrades to today's manual
 * behavior, never to a dumber automation.
 */
import { z } from "zod";
import type { SchedulingConstraintSet } from "@/core/constraints";
import type { NegotiationAction } from "@/core/negotiations";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef } from "./runtime/types";

export interface PolicyCandidate {
  key: string; // "doctorId|startUtc"
  label: string; // "Wed Aug 12, 2:20 PM · Dr. Elena Santos"
  pts: number;
  chips: Array<{ label: string; pts: number }>;
}

export interface PolicyInput {
  caseId: string | null;
  patientName: string;
  /** Rounds already spent / budget. */
  turn: number;
  turnBudget: number;
  set: Pick<SchedulingConstraintSet, "hard" | "soft" | "summary">;
  analysis: {
    asStated: number;
    candidates: PolicyCandidate[];
    relaxations: Array<{
      field: string;
      label: string;
      value: string;
      slotsIfDropped: number;
    }>;
  };
  offerHistory: Array<{ label: string; outcome: string; note?: string }>;
  riskBand?: "low" | "medium" | "high";
}

export const NegotiationActionSchema = z
  .object({
    action: z.enum(["offer_slots", "ask_clarification", "escalate_to_staff"]),
    /** offer_slots: keys of 1–3 candidates, best first. */
    slotKeys: z.array(z.string()).max(3).optional(),
    /** ask_clarification: which hard constraint the question probes. */
    targetField: z.string().optional(),
    /** ask_clarification: the patient-facing question (warm, ≤3 sentences). */
    question: z.string().max(500).optional(),
    /** ask_clarification: up to 3 concrete options phrased for the patient. */
    options: z.array(z.string().max(120)).max(3).optional(),
    /** escalate_to_staff: why a person should take over. */
    reason: z.string().max(500).optional(),
    /** One sentence for the audit trail, always. */
    rationale: z.string().max(500),
  })
  .superRefine((v, ctx) => {
    if (v.action === "offer_slots" && (v.slotKeys?.length ?? 0) === 0)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "offer_slots requires slotKeys",
      });
    if (v.action === "ask_clarification" && (!v.question || !v.targetField))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ask_clarification requires question and targetField",
      });
    if (v.action === "escalate_to_staff" && !v.reason)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "escalate_to_staff requires reason",
      });
  });

const SYSTEM = `You decide the next move in a clinic's appointment rescheduling conversation with one patient. Choose EXACTLY ONE action.

Facts discipline:
- The ONLY availability facts are the candidate slots and relaxation counts provided. Never estimate, never invent times, never reference slots outside the candidate list (use their keys verbatim).
- The patient's constraints were extracted and staff-verified upstream; treat them as accurate.

Decision guidance:
- Candidates exist → offer_slots with the best 1–3 keys (they are pre-ranked; lead with rank 1 unless the offer history shows the patient already declined very similar slots — then pick meaningfully different ones or ask instead).
- Zero candidates → ask_clarification. Target the relaxation with the best realistic yield: highest slotsIfDropped, but weigh plausibility — a patient who wrote "only Dr. Santos, she knows my history" is likelier to flex on time than on doctor. The question must cite ONLY provided counts (e.g. "if afternoons could work, we have 4 options this week"), be warm and brief (≤3 sentences, Taglish is fine if the patient writes Taglish), and offer up to 3 concrete choices.
- escalate_to_staff when: the patient's reply depends on something external ("I'll confirm after my duty schedule comes out"), repeated declines suggest email isn't working, every relaxation yields ~0, or anything feels outside scheduling. Give a reason staff can act on.
- This is round {turn+1} of at most {turnBudget}: the closer to the budget, the more you should prefer closing moves (a strong single offer, or escalation) over exploratory questions.

Never mention internal systems, scores, or that you are an AI. rationale: one sentence for the audit log.`;

export const negotiationPolicyAgent: AgentDef<PolicyInput, NegotiationAction> =
  {
    name: "negotiator",
    feedVerb: (i) => `Deciding the next move with ${i.patientName}`,
    system: SYSTEM,
    tools: [],
    resultSchema:
      NegotiationActionSchema as unknown as z.ZodType<NegotiationAction>,
    maxSteps: 3,
    buildPrompt: (i) => {
      const cands =
        i.analysis.candidates.length === 0
          ? "(none — the constraints as stated match no open slot)"
          : i.analysis.candidates
              .map(
                (c, n) =>
                  `${n + 1}. key=${c.key} · ${c.label} · preference points ${c.pts}${c.chips.length ? ` (${c.chips.map((x) => x.label).join(", ")})` : ""}`,
              )
              .join("\n");
      const relax =
        i.analysis.relaxations.length === 0
          ? "(no hard constraints to relax)"
          : i.analysis.relaxations
              .map(
                (r) =>
                  `- ${r.field} — ${r.label}: ${r.value} → ${r.slotsIfDropped} slots if relaxed`,
              )
              .join("\n");
      const history =
        i.offerHistory.length === 0
          ? "(nothing offered yet this negotiation)"
          : i.offerHistory
              .map(
                (h) =>
                  `- ${h.label} → ${h.outcome}${h.note ? ` (${h.note})` : ""}`,
              )
              .join("\n");
      return (
        `Patient: ${i.patientName}${i.riskBand ? ` · no-show risk: ${i.riskBand}` : ""}\n` +
        `Round: ${i.turn + 1} of ${i.turnBudget}\n\n` +
        `Their accumulated constraints: ${i.set.summary}\n` +
        `hard=${JSON.stringify(i.set.hard)}\nsoft=${JSON.stringify(i.set.soft)}\n\n` +
        `Candidate slots (as stated: ${i.analysis.asStated} match):\n${cands}\n\n` +
        `Relaxation analysis:\n${relax}\n\n` +
        `Offer history:\n${history}`
      );
    },
    fallback: async () => ({
      action: "escalate_to_staff",
      reason: "AI negotiation unavailable — routed to staff with full context.",
      rationale: "Fallback: no model available; a person takes over.",
    }),
  };

export function decideNegotiationMove(input: PolicyInput, ctx: AgentCtx) {
  return runAgent(negotiationPolicyAgent, input, ctx);
}
