import { z } from "zod";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef } from "./runtime/types";
import {
  toolGetPatientHistory,
  toolListUpcoming,
  toolScoreNoShow,
  toolToday,
  upcomingForRisk,
  getPatient,
  patientHistory,
} from "./tools";
import { scoreNoShowRisk } from "@/core/risk";
import { demoNow, fmtWhen } from "@/core/clock";

export const RiskResultSchema = z.object({
  flags: z
    .array(
      z.object({
        appointmentId: z.string(),
        patientId: z.string(),
        patientName: z.string(),
        startUtc: z.string(),
        score: z.number(),
        band: z.enum(["low", "medium", "high"]),
        factors: z.array(z.object({ label: z.string(), pts: z.number() })),
        recommendation: z.enum([
          "confirmation_nudge",
          "preventive_outreach",
          "none",
        ]),
        explanation: z.string().max(700),
      }),
    )
    .max(20),
  summary: z.string().max(600),
});
export type RiskAgentResult = z.infer<typeof RiskResultSchema>;

export interface RiskInputArgs {
  caseId: string | null;
  horizonDays: number;
  /** Only surface flags at/above this band. */
  minBand: "medium" | "high";
}

function explain(
  score: number,
  factors: Array<{ label: string; pts: number }>,
): string {
  const drivers = factors
    .filter((f) => f.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3)
    .map((f) => `${f.label} (+${f.pts})`);
  const protectors = factors
    .filter((f) => f.pts < 0)
    .map((f) => `${f.label} (${f.pts})`);
  return `Score ${score}/100 — driven by ${drivers.join(", ") || "no elevated factors"}${protectors.length ? `; offset by ${protectors.join(", ")}` : ""}. Score is rule-based and fully attributable to the listed factors.`;
}

function deterministicRisk(input: RiskInputArgs): RiskAgentResult {
  const upcoming = upcomingForRisk(input.horizonDays);
  const flags: RiskAgentResult["flags"] = [];
  for (const a of upcoming) {
    const r = scoreNoShowRisk({
      status: a.status,
      startUtc: a.startUtc,
      bookedAt: a.bookedAt,
      now: demoNow(),
      history: patientHistory(a.patientId),
    });
    const qualifies =
      input.minBand === "high" ? r.band === "high" : r.band !== "low";
    if (!qualifies) continue;
    const p = getPatient(a.patientId);
    flags.push({
      appointmentId: a.id,
      patientId: a.patientId,
      patientName: p.name,
      startUtc: a.startUtc,
      score: r.score,
      band: r.band,
      factors: r.factors,
      recommendation:
        r.band === "high" ? "preventive_outreach" : "confirmation_nudge",
      explanation: explain(r.score, r.factors),
    });
  }
  flags.sort((a, b) => b.score - a.score);
  return {
    flags: flags.slice(0, 20),
    summary: `Reviewed ${upcoming.length} upcoming appointments over ${input.horizonDays} days; ${flags.length} at ${input.minBand}+ no-show risk (${fmtWhen(demoNow())}).`,
  };
}

export const riskAgent: AgentDef<RiskInputArgs, RiskAgentResult> = {
  name: "risk",
  feedVerb: (i) =>
    `Reviewing no-show risk across the next ${i.horizonDays} days`,
  system: `You are SchediCare's Attendance-Risk agent.
The no-show score is computed by the deterministic score_no_show tool — you NEVER recompute or adjust it. Your job: decide which flags merit staff attention and write a clear, factor-grounded explanation for each.
Recommendation policy: band=high → preventive_outreach; band=medium AND unconfirmed → confirmation_nudge; otherwise none. Only include flags at or above the requested minimum band. No medical judgment of any kind.
Finish with submit_result.`,
  tools: [toolToday, toolListUpcoming, toolScoreNoShow, toolGetPatientHistory],
  resultSchema: RiskResultSchema,
  maxSteps: 14,
  buildPrompt: (i) =>
    `Review upcoming appointments over the next ${i.horizonDays} days. Score each with score_no_show, keep flags at band "${i.minBand}" or above, attach the factor breakdown and a 1-2 sentence explanation grounded ONLY in the returned factors, and submit.`,
  fallback: async (i) => deterministicRisk(i),
};

export function runRisk(input: RiskInputArgs, ctx: AgentCtx) {
  return runAgent(riskAgent, input, ctx);
}
