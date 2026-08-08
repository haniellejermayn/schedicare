/**
 * Negotiation state (DB is the source of truth) + the deterministic guard
 * that sits between the policy model and any action. The model chooses a
 * move; this module decides whether the move is permitted, counts the turns,
 * and enforces the budget. No model output crosses into action without
 * passing guardPolicyAction.
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { demoNowIso } from "./clock";
import type { SchedulingConstraintSet } from "./constraints";

/** Patient-facing rounds (offers + clarifications) before forced escalation. */
export const NEGOTIATION_TURN_BUDGET = 3;

export type NegotiationRow = typeof schema.negotiations.$inferSelect;

export function getNegotiation(
  caseId: string,
  appointmentId: string,
): NegotiationRow | undefined {
  return db
    .select()
    .from(schema.negotiations)
    .where(
      and(
        eq(schema.negotiations.caseId, caseId),
        eq(schema.negotiations.appointmentId, appointmentId),
      ),
    )
    .get();
}

export function getOrCreateNegotiation(args: {
  caseId: string;
  appointmentId: string;
  patientId: string;
  constraintSet?: SchedulingConstraintSet;
}): NegotiationRow {
  const existing = getNegotiation(args.caseId, args.appointmentId);
  if (existing) return existing;
  db.insert(schema.negotiations)
    .values({
      caseId: args.caseId,
      appointmentId: args.appointmentId,
      patientId: args.patientId,
      constraintSet: args.constraintSet ?? null,
    })
    .run();
  return getNegotiation(args.caseId, args.appointmentId)!;
}

export function updateNegotiation(
  id: string,
  patch: Partial<{
    status: "active" | "resolved" | "escalated";
    turn: number;
    constraintSet: SchedulingConstraintSet;
    offeredSlots: any[];
    lastAction: string;
    lastReason: string;
  }>,
): void {
  db.update(schema.negotiations)
    .set({ ...patch, updatedAt: demoNowIso() })
    .where(eq(schema.negotiations.id, id))
    .run();
}

export function recordOfferedSlot(
  row: NegotiationRow,
  slot: { doctorId: string; startUtc: string; label: string },
): void {
  const history = [...((row.offeredSlots as any[]) ?? [])];
  history.push({ ...slot, offeredAt: demoNowIso(), outcome: "offered" });
  updateNegotiation(row.id, { offeredSlots: history });
}

/** Mark the latest matching offered slot with an outcome (declined/confirmed…). */
export function recordOfferOutcome(
  row: NegotiationRow,
  outcome: string,
  note?: string,
): void {
  const history = [...((row.offeredSlots as any[]) ?? [])];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].outcome === "offered") {
      history[i] = { ...history[i], outcome, ...(note ? { note } : {}) };
      break;
    }
  }
  updateNegotiation(row.id, { offeredSlots: history });
}

// ---------------------------------------------------------------------------
// Policy action guard (pure, exhaustively testable)
// ---------------------------------------------------------------------------

export interface NegotiationAction {
  action: "offer_slots" | "ask_clarification" | "escalate_to_staff";
  slotKeys?: string[];
  targetField?: string;
  question?: string;
  options?: string[];
  reason?: string;
  rationale: string;
}

export interface PolicyGuardCtx {
  /** Rounds already spent. */
  turn: number;
  budget: number;
  /** Keys ("doctorId|startUtc") of slots the deterministic search produced. */
  candidateKeys: string[];
  /** Hard-constraint fields the relaxation analysis actually computed. */
  relaxFields: string[];
  /** Constraint fields we already asked this patient about — asking twice is
   * forbidden: if their answer didn't move the constraints, a person calls. */
  askedFields?: string[];
}

/**
 * The model proposes; this disposes. Violations never throw — they degrade
 * to escalation with the violation recorded, because a confused policy is a
 * reason for a human, not a crash.
 */
export function guardPolicyAction(
  proposed: NegotiationAction,
  ctx: PolicyGuardCtx,
): { action: NegotiationAction; forced?: string } {
  const escalate = (
    why: string,
  ): { action: NegotiationAction; forced: string } => ({
    action: { action: "escalate_to_staff", reason: why, rationale: why },
    forced: why,
  });

  if (ctx.turn >= ctx.budget)
    return escalate(
      `turn budget reached (${ctx.turn}/${ctx.budget}) — negotiation summarized for staff`,
    );

  if (proposed.action === "offer_slots") {
    const valid = (proposed.slotKeys ?? []).filter((k) =>
      ctx.candidateKeys.includes(k),
    );
    if (valid.length === 0)
      return escalate("policy referenced no valid candidate slots");
    return { action: { ...proposed, slotKeys: valid.slice(0, 3) } };
  }
  if (proposed.action === "ask_clarification") {
    if (!proposed.question || !proposed.targetField)
      return escalate("clarification missing question or target");
    if (!ctx.relaxFields.includes(proposed.targetField))
      return escalate(
        `clarification targeted an unknown constraint (${proposed.targetField})`,
      );
    if (ctx.askedFields?.includes(proposed.targetField))
      return escalate(
        `already asked about ${proposed.targetField} and the answer didn't resolve it — a person should call`,
      );
    return {
      action: { ...proposed, options: (proposed.options ?? []).slice(0, 3) },
    };
  }
  return { action: proposed }; // escalate_to_staff passes through
}
