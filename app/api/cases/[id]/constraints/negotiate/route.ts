/**
 * POST: staff delegates the next move to the negotiation loop ("ask the
 * patient"). The policy runs asynchronously via the queue; whatever it drafts
 * (a question or an offer) still lands as a recommendation behind the normal
 * approval gate — this endpoint sends nothing.
 */
import { eq } from "drizzle-orm";
import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { getCase, updateCaseMeta } from "@/core/cases";
import { audit } from "@/core/audit";
import { demoNowIso } from "@/core/clock";
import { SchedulingConstraintSetSchema } from "@/core/constraints";
import { validateConstraintSet } from "@/core/constraintValidation";
import { relaxationAnalysis } from "@/core/constraintMatching";
import { and } from "drizzle-orm";
import { enqueueEvent } from "@/worker/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const c = getCase(params.id);
  const body = await req.json().catch(() => null);
  const parsed = SchedulingConstraintSetSchema.safeParse(body?.set);
  if (!parsed.success) return err("invalid constraint set", 422);
  if (!body?.appointmentId || !body?.supersededRecId)
    return err("appointmentId and supersededRecId required", 422);
  if (body.targetField != null && typeof body.targetField !== "string")
    return err("targetField must be a string", 422);
  const v = validateConstraintSet(parsed.data);
  if (!v.ok) return json({ ok: false, errors: v.errors }, { status: 422 });
  if (
    v.normalized.unresolvedStatements.length > 0 ||
    v.normalized.clinicalContentDetected
  )
    return err(
      "resolve highlighted statements first — the loop only runs on clean sets",
      422,
    );
  const appt = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, body.appointmentId))
    .get();
  const patient = appt
    ? db
        .select()
        .from(schema.patients)
        .where(eq(schema.patients.id, appt.patientId))
        .get()
    : undefined;
  if (!appt || !patient) return err("appointment not found", 404);
  if (body.targetField) {
    const analysis = await relaxationAnalysis({
      set: v.normalized,
      type: appt.type as any,
      ignoreAppointmentId: appt.id,
      originalDoctorId: ((c.meta as any) ?? {}).doctorId ?? appt.doctorId,
      horizonDays: 14,
    });
    if (
      !analysis.relaxations.some(
        (item) =>
          item.field === body.targetField && item.slotsIfDropped > 0,
      )
    )
      return err(
        "targetField must match a computed relaxation that opens availability",
        422,
      );
  }
  // One strategic move at a time: while a drafted question (or any proposal)
  // for this appointment awaits a decision, delegating again would burn a
  // negotiation round for nothing.
  const pending = db
    .select()
    .from(schema.recommendations)
    .where(
      and(
        eq(schema.recommendations.caseId, c.id),
        eq(schema.recommendations.appointmentId, body.appointmentId),
        eq(schema.recommendations.status, "proposed"),
      ),
    )
    .all();
  if (pending.length > 0)
    return err(
      "a drafted message for this patient is already awaiting your decision — approve or reject it first",
      409,
    );
  audit({
    actor: "staff",
    action: "negotiation.delegated",
    refType: "case",
    refId: c.id,
    caseId: c.id,
    detail: { appointmentId: body.appointmentId, targetField: body.targetField },
  });
  const byAppt = ((c.meta as any) ?? {}).constraintsByAppt ?? {};
  const prior = byAppt[body.appointmentId] ?? {};
  const eventId = enqueueEvent("negotiation_turn", {
    caseId: c.id,
    appointmentId: body.appointmentId,
    patientId: patient.id,
    patientName: patient.name,
    supersededRecId: body.supersededRecId,
    set: v.normalized,
    targetField: body.targetField ?? undefined,
    replyRegister: prior.replyRegister ?? "english",
  });
  updateCaseMeta(c.id, {
    constraintsByAppt: {
      ...byAppt,
      [body.appointmentId]: {
        ...prior,
        set: v.normalized,
        appointmentId: body.appointmentId,
        reviewedAt: demoNowIso(),
      },
    },
  });
  return json({ ok: true, eventId });
}
