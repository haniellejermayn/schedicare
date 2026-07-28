import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { demoNowIso } from "./clock";
import { timeline } from "./timeline";
import { audit } from "./audit";
import type { CaseState, Severity } from "./types";

/**
 * Legal transitions. Enforced in code — agents *request* transitions, this
 * module validates them. An LLM cannot teleport a case to `executing`;
 * `awaiting_approval → executing` additionally requires a staff actor.
 */
const LEGAL: Record<CaseState, CaseState[]> = {
  open: ["assessing", "escalated"],
  assessing: ["planning", "escalated"],
  planning: ["awaiting_approval", "escalated"],
  awaiting_approval: ["executing", "escalated"],
  executing: ["resolving", "escalated"],
  resolving: ["planning", "resolved", "escalated"], // counter-proposals loop the affected item back
  escalated: ["assessing", "planning", "resolved"],
  resolved: [],
};

export class TransitionError extends Error {}

export function getCase(caseId: string) {
  const c = db.select().from(schema.cases).where(eq(schema.cases.id, caseId)).get();
  if (!c) throw new Error(`case ${caseId} not found`);
  return c;
}

export function openCase(input: {
  clinicId: string;
  type: (typeof schema.cases.$inferSelect)["type"];
  severity: Severity;
  title: string;
  openedByEvent?: string;
  meta?: unknown;
}) {
  const row = db
    .insert(schema.cases)
    .values({
      clinicId: input.clinicId,
      type: input.type,
      severity: input.severity,
      state: "open",
      title: input.title,
      openedByEvent: input.openedByEvent ?? null,
      meta: input.meta ?? null,
      createdAt: demoNowIso(),
      updatedAt: demoNowIso(),
    })
    .returning()
    .get();
  timeline(row.id, "orchestrator", "status", `Case opened — ${input.title}`, null, { severity: input.severity });
  audit({ actor: "orchestrator", action: "case.opened", refType: "case", refId: row.id, caseId: row.id, detail: { type: input.type, severity: input.severity } });
  return row;
}

export function transitionCase(caseId: string, to: CaseState, actor: string, reason: string): void {
  const c = getCase(caseId);
  const from = c.state as CaseState;
  if (from === to) return;
  if (!LEGAL[from]?.includes(to)) {
    throw new TransitionError(`Illegal transition ${from} → ${to} (case ${caseId})`);
  }
  if (to === "executing" && !actor.startsWith("staff")) {
    throw new TransitionError(
      `Only a staff decision can move a case from awaiting_approval to executing (actor was "${actor}")`
    );
  }
  db.update(schema.cases)
    .set({
      state: to,
      updatedAt: demoNowIso(),
      resolvedAt: to === "resolved" ? demoNowIso() : c.resolvedAt,
    })
    .where(eq(schema.cases.id, caseId))
    .run();
  timeline(caseId, actor, "transition", `${from.replace(/_/g, " ")} → ${to.replace(/_/g, " ")}`, reason);
  audit({ actor, action: "case.transition", refType: "case", refId: caseId, caseId, detail: { from, to, reason } });
}

export function escalateCase(caseId: string, actor: string, reason: string): void {
  const c = getCase(caseId);
  if (c.state === "escalated" || c.state === "resolved") return;
  db.update(schema.cases).set({ state: "escalated", updatedAt: demoNowIso() }).where(eq(schema.cases.id, caseId)).run();
  timeline(caseId, actor, "escalation", "Escalated to clinic staff", reason);
  audit({ actor, action: "case.escalated", refType: "case", refId: caseId, caseId, detail: { reason } });
}

export function updateCaseMeta(caseId: string, patch: Record<string, unknown>): void {
  const c = getCase(caseId);
  const meta = { ...((c.meta as Record<string, unknown>) ?? {}), ...patch };
  db.update(schema.cases).set({ meta, updatedAt: demoNowIso() }).where(eq(schema.cases.id, caseId)).run();
}

/** Any recommendation still needing staff or executor attention? */
export function pendingRecommendationCounts(caseId: string) {
  const recs = db
    .select({ status: schema.recommendations.status })
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, caseId))
    .all();
  return {
    proposed: recs.filter((r) => r.status === "proposed").length,
    approvedUnexecuted: recs.filter((r) => r.status === "approved" || r.status === "modified").length,
    total: recs.length,
  };
}

/**
 * A resolving case resolves once nothing is pending: no proposed or
 * approved-but-unexecuted recommendations, and every executed reschedule has a
 * recorded patient outcome.
 */
export function maybeResolveCase(caseId: string, actor = "orchestrator"): boolean {
  const c = getCase(caseId);
  if (c.state !== "resolving" && c.state !== "escalated") return false;
  const counts = pendingRecommendationCounts(caseId);
  if (counts.proposed > 0 || counts.approvedUnexecuted > 0) return false;
  const recommendations = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, caseId))
    .all();
  const terminalManual = new Set(["called", "handled", "released"]);
  const awaitingPatientOrStaff = recommendations.some((r) => {
    if (r.outcome && terminalManual.has(r.outcome)) return false;
    if (r.status === "rejected" || r.status === "failed") return true;
    if (r.outcome === "needs_human" || r.outcome === "declined") return true;
    return r.status === "executed" && (r.outcome === "pending" || r.outcome === "sent");
  });
  if (awaitingPatientOrStaff) return false;
  const heldAppointmentIds = recommendations
    .map((r) => (r.payload as any)?.createdAppointmentId as string | undefined)
    .filter((id): id is string => !!id);
  if (
    heldAppointmentIds.some(
      (id) =>
        db.select().from(schema.appointments).where(eq(schema.appointments.id, id)).get()?.status === "booked",
    )
  ) {
    return false;
  }
  transitionCase(caseId, "resolved", actor, "All items handled — recoveries executed and patient replies accounted for.");
  return true;
}
