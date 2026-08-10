import { z } from "zod";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef } from "./runtime/types";
import {
  toolGetAffected,
  toolGetDayLoad,
  toolGetPatientHistory,
  toolGetWaitlist,
  toolToday,
  affectedAppointments,
  getPatient,
  patientHistory,
} from "./tools";
import { fmtWhen } from "@/core/clock";

export const AssessmentResultSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string().max(700),
  items: z
    .array(
      z.object({
        appointmentId: z.string(),
        patientId: z.string(),
        patientName: z.string(),
        type: z.enum(["routine", "follow_up", "urgent"]),
        startUtc: z.string(),
        priorityRank: z.number().int().min(1),
        priorityReason: z.string().max(350),
        tags: z.array(z.string()).max(5),
      }),
    )
    .max(30),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

export interface AssessmentInput {
  caseId: string;
  doctorId: string;
  doctorName: string;
  date: string;
  reason: string;
}

const TYPE_WEIGHT: Record<string, number> = {
  urgent: 3,
  follow_up: 2,
  routine: 1,
};

function deterministicAssessment(input: AssessmentInput): AssessmentResult {
  const appts = affectedAppointments(input.doctorId, input.date);
  const enriched = appts.map((a) => {
    const p = getPatient(a.patientId);
    const hist = patientHistory(a.patientId);
    const tags: string[] = [];
    if ((p.notes ?? "").toLowerCase().includes("post-op"))
      tags.push("post-op continuity");
    if (a.type === "urgent") tags.push("urgent visit");
    if (hist.filter((h) => h.kind === "no_show").length > 0)
      tags.push("prior no-show");
    const sortKey = TYPE_WEIGHT[a.type] * 100;
    return { a, p, tags, sortKey };
  });
  enriched.sort(
    (x, y) => y.sortKey - x.sortKey || x.a.startUtc.localeCompare(y.a.startUtc),
  );
  const items = enriched.map((e, i) => {
    const reasons: string[] = [];
    if (e.tags.includes("post-op continuity"))
      reasons.push("post-op follow-up needs continuity");
    if (e.a.type === "urgent") reasons.push("urgent appointment type");
    reasons.push(`scheduled ${fmtWhen(e.a.startUtc)}`);
    return {
      appointmentId: e.a.id,
      patientId: e.a.patientId,
      patientName: e.p.name,
      type: e.a.type as "routine" | "follow_up" | "urgent",
      startUtc: e.a.startUtc,
      priorityRank: i + 1,
      priorityReason: reasons.join(" · "),
      tags: e.tags.slice(0, 5),
    };
  });
  const n = items.length;
  const severity: AssessmentResult["severity"] =
    n >= 8 ? "critical" : n >= 4 ? "high" : n >= 2 ? "medium" : "low";
  const summary = `${input.doctorName} is out on ${input.date} (${input.reason}). ${n} upcoming appointment${n === 1 ? "" : "s"} affected — ${items.filter((i) => i.type === "follow_up").length} follow-up, ${items.filter((i) => i.type === "urgent").length} urgent, ${items.filter((i) => i.type === "routine").length} routine. Recovery ordered by visit type, timing, and continuity needs; no clinical judgment applied.`;
  return { severity, summary, items };
}

export const assessmentAgent: AgentDef<AssessmentInput, AssessmentResult> = {
  name: "assessment",
  feedVerb: (i) => `Mapping the blast radius for ${i.doctorName} on ${i.date}`,
  system: `You are SchediCare's Disruption Assessment agent for a single outpatient clinic.
Given a doctor's emergency unavailability, identify every affected appointment and produce an OPERATIONAL priority order.
Hard rules:
- You are not a clinician. NEVER infer clinical urgency from symptoms or perform triage. Priority may use ONLY: appointment type, follow-up continuity needs (e.g. post-op notes), patient waiting duration, time until appointment, doctor availability, and the number of affected appointments.
- Describe urgency and impact ONLY — never prescribe the recovery action (which doctor, which day, which slot, or "should be seen today/first thing"). Ranking and staff decide that downstream; priorityReason and summary must not recommend placements.
- Write priorityReason and summary in concise staff-facing language. Never mention schema fields, numeric enum values, ranks, scores, model behavior, or implementation details.
- Use get_affected_appointments for ground truth; do not invent appointments.
- Severity guide: 1 affected = low, 2-3 = medium, 4-7 = high, 8+ = critical.
- Finish by calling submit_result with every affected appointment ranked (priorityRank starts at 1).`,
  tools: [
    toolToday,
    toolGetAffected,
    toolGetPatientHistory,
    toolGetWaitlist,
    toolGetDayLoad,
  ],
  resultSchema: AssessmentResultSchema,
  maxSteps: 6,
  buildPrompt: (i) =>
    `Doctor ${i.doctorName} (${i.doctorId}) has emergency unavailability on ${i.date}. Reason given: "${i.reason}". Assess the disruption for case ${i.caseId}: list affected appointments, rank recovery priority with a concise non-technical reason each, tag notable context (post-op continuity or urgent visit type), set severity, and summarize in 2-3 sentences.`,
  fallback: async (i) => deterministicAssessment(i),
};

export function runAssessment(input: AssessmentInput, ctx: AgentCtx) {
  return runAgent(assessmentAgent, input, ctx);
}
