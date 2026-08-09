import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, eq } from "drizzle-orm";
import { demoNowIso, fmtWhen, manilaDate } from "@/core/clock";
import { findOpenSlots } from "@/core/scheduling";
import { rebuiltOfferDraft } from "@/agents/comms";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import {
  getCase,
  pendingConstraintReviews,
  pendingRecommendationCounts,
  transitionCase,
} from "@/core/cases";
import { enqueueEvent } from "@/worker/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * THE approval gate. Only this endpoint (and approve-all, which calls the same
 * logic) moves recommendations out of `proposed`, and only when no proposals
 * remain does the case transition to `executing` — always with actor "staff".
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const b = await body<{
    action: "approve" | "modify" | "reject";
    optionId?: string;
    reason?: string;
    slot?: { doctorId: string; startUtc: string };
    flagCall?: boolean;
  }>(req);
  const rec = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, params.id))
    .get();
  if (!rec) return err("recommendation not found", 404);
  if (rec.status !== "proposed")
    return err(`recommendation already ${rec.status}`, 409);
  const c = getCase(rec.caseId);
  // Escalated cases keep their approval gate: a proposal drafted for one
  // patient stays decidable even after a different patient's reply escalated
  // the case. Anything else (executing, resolving, resolved) is a real 409.
  if (c.state !== "awaiting_approval" && c.state !== "escalated")
    return err(
      `case is ${c.state} — decisions apply only while a proposal is pending (awaiting_approval or escalated)`,
      409,
    );

  const payload = rec.payload as any;
  if (
    pendingConstraintReviews(rec.caseId, {
      patientId: rec.patientId ?? payload.patientId,
      appointmentId: payload.appointmentId,
    }).length > 0
  ) {
    return err(
      "Required constraint review must be completed before acting on this patient.",
      409,
    );
  }

  if (b.action === "approve") {
    db.update(schema.recommendations)
      .set({ status: "approved", decidedBy: "staff", decidedAt: demoNowIso() })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(
      rec.caseId,
      "staff",
      "decision",
      `Approved: ${payload.patientName ?? rec.kind}`,
      undefined,
      { recommendationId: rec.id },
    );
  } else if (b.action === "modify") {
    let optionId = b.optionId;
    let options: any[] = payload.options ?? [];
    if (!optionId && b.slot?.doctorId && b.slot?.startUtc) {
      // Staff-picked slot outside the ranked list: accepted ONLY if the slot
      // engine itself offers that exact start right now (rules, windows,
      // caps, buffers, calendars all enforced). Staff can override the
      // RANKING — never the validator.
      const day = manilaDate(b.slot.startUtc);
      const open = await findOpenSlots({
        doctorId: b.slot.doctorId,
        type: payload.type,
        fromDay: day,
        toDay: day,
        ignoreAppointmentId: payload.appointmentId,
        limit: 200,
      });
      const hit = (open as any[]).find(
        (s) =>
          s.startUtc === b.slot!.startUtc && s.doctorId === b.slot!.doctorId,
      );
      if (!hit)
        return err(
          "that time isn't an open, rule-valid slot for this doctor right now",
          422,
        );
      const doc = db
        .select()
        .from(schema.doctors)
        .where(eq(schema.doctors.id, b.slot.doctorId))
        .get();
      const manual = {
        ...hit,
        doctorName: (hit as any).doctorName ?? doc?.name ?? b.slot.doctorId,
        id: `opt_staff_${Date.now().toString(36)}`,
        chips: [{ label: "Staff picked" }],
      };
      options = [...options, manual];
      optionId = manual.id;
    }
    if (!optionId) return err("modify requires optionId or slot");
    const valid = options.some((o: any) => o.id === optionId);
    if (!valid)
      return err(
        "optionId must be one of the validator-approved options on this recommendation",
        422,
      );
    const opt = options.find((o: any) => o.id === optionId);
    // Sibling-conflict guard: recovery ranking dedupes slots ACROSS patients,
    // but a staff pick bypasses that — without this check the conflict only
    // surfaces as an execution-time veto ("Couldn't complete") after the
    // sibling's hold lands. Refuse it here, with a name, while it's fixable.
    const siblings = db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.caseId, rec.caseId))
      .all()
      .filter(
        (r) =>
          r.id !== rec.id &&
          (r.kind === "reschedule" || r.kind === "waitlist_fill") &&
          ["proposed", "approved", "modified"].includes(r.status),
      );
    for (const s of siblings) {
      const sp = s.payload as any;
      const so = (sp.options ?? []).find(
        (o: any) => o.id === (sp.modifiedOptionId ?? sp.chosenOptionId),
      );
      if (!so || so.doctorId !== opt.doctorId) continue;
      const overlap = so.startUtc < opt.endUtc && opt.startUtc < so.endUtc;
      if (overlap)
        return err(
          `that time overlaps the slot already being offered to ${sp.patientName ?? "another patient"} on this case — pick another time, or change theirs first`,
          422,
        );
    }
    // Re-render the patient message deterministically for the slot actually
    // chosen (template substitution, never a model redraft) so the preview
    // and the sent mail always match the calendar. This intentionally
    // replaces any staff wording edit — the modal says so.
    const rebuiltDraft =
      payload.draft && rec.kind === "reschedule"
        ? {
            ...payload.draft,
            ...rebuiltOfferDraft({
              patientId: payload.patientId,
              patientName: payload.patientName ?? "Patient",
              appointmentId: payload.appointmentId,
              context: {
                reason: payload.replanOf ? "counter" : undefined,
                doctorName: payload.from?.doctorName,
                originalWhen: payload.from?.when,
                proposedWhen: fmtWhen(opt.startUtc),
                proposedDoctorName: opt.doctorName,
              },
            } as any),
          }
        : payload.draft;
    // A time change is a REVISION, not a decision: the recommendation stays
    // `proposed`, pointed at the new slot with its message re-templated, so
    // the thing staff eventually Approve is exactly the thing that gets
    // sent. Ranking provenance is replaced — the pick is now staff's.
    const revised = options.map((o: any) =>
      o.id === optionId ? { ...o, chips: [{ label: "Staff picked" }] } : o,
    );
    db.update(schema.recommendations)
      .set({
        payload: {
          ...payload,
          options: revised,
          chosenOptionId: optionId,
          staffPickedOptionId: optionId,
          draft: rebuiltDraft,
          draftEditedByStaff: false,
        },
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(
      rec.caseId,
      "staff",
      "decision",
      `Time changed: ${payload.patientName ?? rec.kind} → ${fmtWhen(opt.startUtc)} — awaiting approval`,
      b.reason,
      { recommendationId: rec.id },
    );
  } else if (b.action === "reject") {
    if (!b.reason || b.reason.trim().length < 3)
      return err("reject requires a reason");
    db.update(schema.recommendations)
      .set({
        status: "rejected",
        decidedBy: "staff",
        decidedAt: demoNowIso(),
        decisionReason: b.reason.trim(),
        // flagCall defaults ON: an undelivered suggestion means someone
        // should ring the patient unless staff explicitly say otherwise.
        payload: { ...payload, flagForCall: b.flagCall !== false },
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(
      rec.caseId,
      "staff",
      "decision",
      `Rejected: ${payload.patientName ?? rec.kind}`,
      b.reason.trim(),
      { recommendationId: rec.id },
    );
  } else {
    return err("action must be approve, modify, or reject");
  }

  audit({
    actor: "staff",
    action: `recommendation.${b.action}`,
    refType: "recommendation",
    refId: rec.id,
    caseId: rec.caseId,
    detail: { optionId: b.optionId, reason: b.reason },
  });

  // When every recommendation is decided, staff's decision moves the case forward.
  const counts = pendingRecommendationCounts(rec.caseId);
  let transitioned = false;
  if (counts.proposed === 0) {
    transitionCase(
      rec.caseId,
      "executing",
      "staff",
      "All recommendations decided — executing approved actions.",
    );
    enqueueEvent("resume_case", { caseId: rec.caseId });
    transitioned = true;
  }
  return json({ ok: true, transitioned, remainingProposed: counts.proposed });
}
