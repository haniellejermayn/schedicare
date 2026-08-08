/**
 * One negotiation turn: analyze (deterministic) → policy (LLM, closed action
 * set) → guard (deterministic) → act (existing machinery only).
 *
 * Called from reply routing when a live-extracted counter needs strategy:
 * second-and-later rounds, any zero-slot situation, or a reply to a
 * clarification. The merged constraint set arrives from upstream (the
 * extractor + validator in worker/replies.ts); this module never talks to
 * the patient directly — offers go through replanWithConstraintSet and
 * clarifications become `clarification` recommendations, both landing behind
 * the normal DecisionCard approval gate.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNowIso, fmtWhen } from "@/core/clock";
import {
  escalateCase,
  getCase,
  transitionCase,
  updateCaseMeta,
} from "@/core/cases";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import { relaxationAnalysis } from "@/core/constraintMatching";
import type { SchedulingConstraintSet } from "@/core/constraints";
import {
  NEGOTIATION_TURN_BUDGET,
  getOrCreateNegotiation,
  guardPolicyAction,
  updateNegotiation,
} from "@/core/negotiations";
import {
  decideNegotiationMove,
  type PolicyCandidate,
} from "@/agents/negotiationPolicy";
import { replanWithConstraintSet } from "./steps";
import { id as newId } from "@/core/ids";

/** Patient-facing text the policy wrote must stay inside scheduling. */
function clarificationLintIssues(text: string): string[] {
  const issues: string[] = [];
  if (
    /\b(diagnos\w*|prescri\w*|medication|dosage|treatment|symptom\w*)\b/i.test(
      text,
    )
  )
    issues.push("mentions clinical topics");
  if (/\b(guarantee|discount|refund|free of charge|libre)\b/i.test(text))
    issues.push("makes promises");
  if (text.length > 600) issues.push("too long");
  return issues;
}

export interface NegotiationTurnArgs {
  caseId: string;
  /** ORIGINAL appointment id (assessment key). */
  appointmentId: string;
  patientId: string;
  patientName: string;
  /** The recommendation this reply answered — superseded by whatever we do. */
  supersededRecId: string;
  /** The MERGED, validated constraint set from upstream. */
  set: SchedulingConstraintSet;
}

export async function negotiationTurn(
  args: NegotiationTurnArgs,
): Promise<void> {
  const { caseId } = args;
  // A negotiation only exists over a live thread: if the recommendation this
  // reply answered reached a terminal outcome (patient cancelled, hold
  // released, staff handled it), there is nothing to negotiate.
  const supersededRec = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, args.supersededRecId))
    .get();
  const terminal = ["cancelled", "released", "called", "handled"];
  if (supersededRec?.outcome && terminal.includes(supersededRec.outcome)) {
    timeline(
      caseId,
      "negotiator",
      "status",
      `No negotiation for ${args.patientName} — the thread already ended (${supersededRec.outcome})`,
      args.set.summary,
      { appointmentId: args.appointmentId },
    );
    const existing = getOrCreateNegotiation({
      caseId,
      appointmentId: args.appointmentId,
      patientId: args.patientId,
    });
    if (existing.status === "active")
      updateNegotiation(existing.id, {
        status: "resolved",
        lastReason: `thread ${supersededRec.outcome}`,
      });
    return;
  }

  const nego = getOrCreateNegotiation({
    caseId,
    appointmentId: args.appointmentId,
    patientId: args.patientId,
    constraintSet: args.set,
  });

  if (nego.status !== "active") {
    // Staff already own this conversation — surface the new message, do not
    // restart automation underneath them.
    db.update(schema.recommendations)
      .set({ outcome: "needs_human" })
      .where(eq(schema.recommendations.id, args.supersededRecId))
      .run();
    timeline(
      caseId,
      "negotiator",
      "escalation",
      `${args.patientName} replied again after the negotiation was handed to staff`,
      args.set.summary,
      { appointmentId: args.appointmentId },
    );
    return;
  }
  updateNegotiation(nego.id, { constraintSet: args.set });

  const c = getCase(caseId);
  if (c.state === "resolving" || c.state === "escalated")
    transitionCase(
      caseId,
      "planning",
      "negotiator",
      `Negotiation round ${nego.turn + 1} with ${args.patientName}`,
    );

  const meta = (getCase(caseId).meta as any) ?? {};
  const appt = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, args.appointmentId))
    .get();
  if (!appt)
    throw new Error(
      `negotiationTurn: appointment ${args.appointmentId} not found`,
    );
  const doctors = new Map(
    db
      .select()
      .from(schema.doctors)
      .all()
      .map((d) => [d.id, d.name]),
  );

  const analysis = await relaxationAnalysis({
    set: args.set,
    type: appt.type as any,
    ignoreAppointmentId: args.appointmentId,
    originalDoctorId: meta.doctorId ?? appt.doctorId,
    horizonDays: 14,
  });
  const candidates: PolicyCandidate[] = analysis.topSlots.map((s) => ({
    key: `${s.slot.doctorId}|${s.slot.startUtc}`,
    label: `${fmtWhen(s.slot.startUtc)} · ${doctors.get(s.slot.doctorId) ?? s.slot.doctorId}`,
    pts: s.pts,
    chips: s.chips,
  }));

  const run = await decideNegotiationMove(
    {
      caseId,
      patientName: args.patientName,
      turn: nego.turn,
      turnBudget: NEGOTIATION_TURN_BUDGET,
      set: {
        hard: args.set.hard,
        soft: args.set.soft,
        summary: args.set.summary,
      },
      analysis: {
        asStated: analysis.asStated,
        candidates,
        relaxations: analysis.relaxations,
      },
      offerHistory: ((nego.offeredSlots as any[]) ?? []).map((o) => ({
        label: o.label,
        outcome: o.outcome,
        note: o.note,
      })),
    },
    { caseId },
  );
  const { action, forced } = guardPolicyAction(run.output, {
    turn: nego.turn,
    budget: NEGOTIATION_TURN_BUDGET,
    candidateKeys: candidates.map((x) => x.key),
    relaxFields: analysis.relaxations.map((r) => r.field),
  });
  timeline(
    caseId,
    "negotiator",
    action.action === "escalate_to_staff" ? "escalation" : "status",
    `Negotiation round ${nego.turn + 1}/${NEGOTIATION_TURN_BUDGET}: ${
      action.action === "offer_slots"
        ? "offering a new time"
        : action.action === "ask_clarification"
          ? "asking the patient a question"
          : "handing to staff"
    }`,
    `${run.output.rationale}${forced ? ` · guard override: ${forced}` : ""} · ${analysis.asStated} slot(s) match as stated`,
    { appointmentId: args.appointmentId },
  );
  updateNegotiation(nego.id, {
    lastAction: action.action,
    lastReason: forced ?? run.output.rationale,
  });

  if (action.action === "offer_slots") {
    const [doctorId, startUtc] = action.slotKeys![0].split("|");
    await replanWithConstraintSet(caseId, {
      appointmentId: args.appointmentId,
      supersededRecId: args.supersededRecId,
      set: args.set,
      note: `Negotiation round ${nego.turn + 1}: ${run.output.rationale}`.slice(
        0,
        200,
      ),
      chosenSlot: { doctorId, startUtc },
    });
    return; // replanWithConstraintSet records the offer + bumps the turn
  }

  if (action.action === "ask_clarification") {
    const relax = analysis.relaxations.find(
      (r) => r.field === action.targetField,
    );
    const lintIssues = clarificationLintIssues(
      `${action.question} ${(action.options ?? []).join(" ")}`,
    );
    if (lintIssues.length > 0) {
      escalateCase(
        caseId,
        "negotiator",
        `Drafted question failed the content lint (${lintIssues.join(", ")}) — staff should contact ${args.patientName}`,
      );
      updateNegotiation(nego.id, {
        status: "escalated",
        lastReason: `lint: ${lintIssues.join(", ")}`,
      });
      return;
    }
    // The template owns the greeting/sign-off; strip any greeting the model
    // added anyway so the patient never reads "Hi Camille, Hi Camille!".
    const firstName = args.patientName.split(" ")[0];
    const question = (action.question ?? "")
      .replace(
        new RegExp(
          `^\\s*(hi|hello|hi po|hello po|kumusta|magandang \\w+)\\s*(${firstName})?\\s*[!,.:]*\\s*`,
          "i",
        ),
        "",
      )
      .trim();
    // Continue the existing conversation thread when we know it.
    const lastOutbound = db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.recommendationId, args.supersededRecId))
      .all()
      .filter((m) => m.direction === "outbound")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    const threadId = lastOutbound?.threadId ?? undefined;
    const subject = lastOutbound?.subject
      ? `Re: ${lastOutbound.subject.replace(/^(re:\s*)+/i, "")}`
      : "Quick question about your appointment";
    const body =
      `Hi ${firstName},\n\n` +
      `${question}\n` +
      ((action.options?.length ?? 0) > 0
        ? `\nYou can reply with something like:\n${action.options!.map((o) => `• ${o}`).join("\n")}\n`
        : "") +
      `\nJust reply to this email and we'll take care of the rest.\n\nRiverside Family Clinic`;
    const recId = newId();
    db.insert(schema.recommendations)
      .values({
        id: recId,
        caseId,
        appointmentId: args.appointmentId,
        patientId: args.patientId,
        kind: "clarification",
        payload: {
          patientId: args.patientId,
          patientName: args.patientName,
          appointmentId: args.appointmentId,
          question: action.question,
          choices: action.options ?? [],
          targetField: action.targetField,
          relaxationYield: relax?.slotsIfDropped ?? null,
          rationale: run.output.rationale,
          draft: { subject, body, ...(threadId ? { threadId } : {}) },
        },
        explanation: run.output.rationale,
        status: "proposed",
        createdAt: demoNowIso(),
      })
      .run();
    db.update(schema.recommendations)
      .set({ supersededBy: recId, outcome: "superseded" })
      .where(eq(schema.recommendations.id, args.supersededRecId))
      .run();
    // Asking counts against the budget the moment it is drafted — conservative
    // by design (a rejected draft still consumed a round of strategy).
    updateNegotiation(nego.id, { turn: nego.turn + 1 });
    audit({
      actor: "negotiator",
      action: "negotiation.clarification_drafted",
      refType: "recommendation",
      refId: recId,
      caseId,
      detail: { question: action.question, targetField: action.targetField },
    });
    timeline(
      caseId,
      "comms",
      "recommendation",
      `Question for ${args.patientName} drafted — awaiting staff approval`,
      relax
        ? `If "${relax.label}: ${relax.value}" can flex, ${relax.slotsIfDropped} option(s) open up.`
        : action.question,
      { recommendationId: recId },
    );
    transitionCase(
      caseId,
      "awaiting_approval",
      "orchestrator",
      "Clarification drafted — nothing is sent until staff approve.",
    );
    return;
  }

  // escalate_to_staff
  db.update(schema.recommendations)
    .set({ outcome: "needs_human" })
    .where(eq(schema.recommendations.id, args.supersededRecId))
    .run();
  const offers = ((nego.offeredSlots as any[]) ?? []).length;
  escalateCase(
    caseId,
    "negotiator",
    `${args.patientName}: ${action.reason} (after ${nego.turn} round${nego.turn === 1 ? "" : "s"}, ${offers} offer${offers === 1 ? "" : "s"})`,
  );
  const m2 = (getCase(caseId).meta as any) ?? {};
  updateCaseMeta(caseId, {
    needsCallback: [
      ...(m2.needsCallback ?? []),
      {
        patientId: args.patientId,
        patientName: args.patientName,
        reason: action.reason,
      },
    ],
  });
  updateNegotiation(nego.id, { status: "escalated" });
}
