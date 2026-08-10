import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNow } from "@/core/clock";

export interface Scoreboard {
  affected: number;
  proposed: number;
  approved: number;
  executed: number;
  rebooked: number;
  confirmed: number;
  declinedOrCallback: number;
}

/** Recovery scoreboard for one case (drives the ops header + admin metrics). */
export function caseScoreboard(caseId: string): Scoreboard {
  const recs = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, caseId)).all();
  const substantive = recs.filter((r) => r.kind === "reschedule" || r.kind === "waitlist_fill");
  const s: Scoreboard = {
    affected: substantive.filter((r) => r.outcome !== "superseded").length,
    proposed: recs.filter((r) => r.status === "proposed").length,
    approved: recs.filter((r) => r.status === "approved" || r.status === "modified").length,
    executed: recs.filter((r) => r.status === "executed").length,
    rebooked: 0,
    confirmed: 0,
    declinedOrCallback: 0,
  };
  for (const r of substantive) {
    const payload = r.payload as any;
    // A superseded execution (e.g. the pre-counter offer) is replaced by its
    // replan and must not double-count as a recovery.
    if (r.status === "executed" && r.outcome !== "superseded" && payload.createdAppointmentId) {
      s.rebooked += 1;
      const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, payload.createdAppointmentId)).get();
      if (appt) {
        if (appt.status === "confirmed") {
          s.confirmed += 1;
        }
        if (appt.status === "cancelled_by_patient") s.declinedOrCallback += 1;
      }
    }
    if (r.outcome === "needs_human" || r.status === "rejected") s.declinedOrCallback += 1;
  }
  return s;
}

export interface AdminMetrics {
  cases: { total: number; open: number; awaitingApproval: number; resolved: number; escalated: number };
  recommendations: { proposed: number; executed: number; accepted: number; declined: number; needsHuman: number };
  agentRuns: { total: number; live: number; fallback: number; errors: number; avgLatencyMs: number; toolCalls: number; toolErrors: number };
  appointments: { upcoming: number; unconfirmed: number; needsCallback: number };
}

export function adminMetrics(): AdminMetrics {
  const cases = db.select().from(schema.cases).all();
  const recs = db.select().from(schema.recommendations).all();
  const runs = db.select().from(schema.agentRuns).all();
  const upcoming = db
    .select()
    .from(schema.appointments)
    .where(and(inArray(schema.appointments.status, ["booked", "confirmed"]), gt(schema.appointments.startUtc, demoNow().toISOString())))
    .all();

  const finishedRuns = runs.filter((r) => r.latencyMs != null);
  return {
    cases: {
      total: cases.length,
      open: cases.filter((c) => !["resolved", "escalated"].includes(c.state)).length,
      awaitingApproval: cases.filter((c) => c.state === "awaiting_approval").length,
      resolved: cases.filter((c) => c.state === "resolved").length,
      escalated: cases.filter((c) => c.state === "escalated").length,
    },
    recommendations: {
      proposed: recs.filter((r) => r.status === "proposed").length,
      executed: recs.filter((r) => r.status === "executed").length,
      accepted: recs.filter((r) => r.outcome === "accepted").length,
      declined: recs.filter((r) => r.outcome === "declined").length,
      needsHuman: recs.filter((r) => r.outcome === "needs_human").length,
    },
    agentRuns: {
      total: runs.length,
      live: runs.filter((r) => r.mode === "live").length,
      fallback: runs.filter((r) => r.mode === "fallback").length,
      errors: runs.filter((r) => r.status === "error").length,
      avgLatencyMs: finishedRuns.length ? Math.round(finishedRuns.reduce((a, r) => a + (r.latencyMs ?? 0), 0) / finishedRuns.length) : 0,
      toolCalls: runs.reduce((a, r) => a + r.toolCalls, 0),
      toolErrors: runs.reduce((a, r) => a + r.toolErrors, 0),
    },
    appointments: {
      upcoming: upcoming.length,
      unconfirmed: upcoming.filter((a) => a.status === "booked").length,
      needsCallback: db.select().from(schema.appointments).where(eq(schema.appointments.needsCallback, true)).all().length,
    },
  };
}
