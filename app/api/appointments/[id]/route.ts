import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { enqueueEvent } from "@/worker/queue";
import { pickCalendarProvider, markCalendarHealthy, markCalendarUnhealthy } from "@/integrations/factory";
import { getDoctor } from "@/agents/tools";
import { demoNow } from "@/core/clock";
import { deleteCalendarEvent, updateCalendarEvent } from "@/worker/executor";
import { maybeResolveCase } from "@/core/cases";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, params.id)).get();
  if (!appt) return err("appointment not found", 404);
  return json({ appointment: appt });
}

/** Human actions on one appointment: { action: "confirm" | "cancel" }. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  boot();
  const b = await body<{ action: "confirm" | "cancel"; actor?: "patient" | "staff" }>(req);
  const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, params.id)).get();
  if (!appt) return err("appointment not found", 404);
  const actor = b.actor ?? "patient";

  if (b.action === "confirm") {
    if (!["booked", "confirmed"].includes(appt.status)) return err(`cannot confirm a ${appt.status} appointment`, 409);
    const holdRecommendation =
      appt.status === "booked" && appt.source === "schedicare"
        ? db
            .select()
            .from(schema.recommendations)
            .all()
            .find((r) => (r.payload as any)?.createdAppointmentId === appt.id)
        : undefined;
    if (appt.status === "booked" && appt.source === "schedicare") {
      const doctor = getDoctor(appt.doctorId);
      const patch = {
        summary: `${db.select().from(schema.patients).where(eq(schema.patients.id, appt.patientId)).get()?.name ?? appt.patientId} — ${appt.type.replace("_", " ")}`,
        description: holdRecommendation
          ? `Confirmed by patient through SchediCare. Case ${holdRecommendation.caseId}.`
          : "Confirmed by patient through SchediCare.",
      };
      let updated = true;
      if (holdRecommendation) {
        updated = await updateCalendarEvent(
          holdRecommendation.caseId,
          doctor.calendarId,
          appt.calendarEventId,
          patch,
        );
      } else if (doctor.calendarId && appt.calendarEventId) {
        const pick = pickCalendarProvider();
        try {
          await pick.provider.updateEvent(doctor.calendarId, appt.calendarEventId, patch);
          if (pick.live) markCalendarHealthy();
        } catch (e) {
          if (pick.live) markCalendarUnhealthy(e);
          updated = false;
        }
      }
      if (!updated) return err("Calendar could not confirm the hold; the appointment remains unchanged", 502);
    }
    db.update(schema.appointments)
      .set({ status: "confirmed", needsCallback: false })
      .where(eq(schema.appointments.id, appt.id))
      .run();
    if (holdRecommendation) {
      const payload = holdRecommendation.payload as any;
      db.update(schema.recommendations)
        .set({ outcome: "accepted" })
        .where(eq(schema.recommendations.id, holdRecommendation.id))
        .run();
      if (holdRecommendation.kind === "waitlist_fill" && payload.chosenWaitlistId) {
        db.update(schema.waitlist)
          .set({ status: "scheduled" })
          .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
          .run();
      }
      maybeResolveCase(holdRecommendation.caseId, actor);
    }
    audit({ actor, action: "appointment.confirmed", refType: "appointment", refId: appt.id });
    return json({ ok: true, status: "confirmed" });
  }

  if (b.action === "cancel") {
    if (!["booked", "confirmed"].includes(appt.status)) return err(`cannot cancel a ${appt.status} appointment`, 409);
    const holdRecommendation =
      appt.status === "booked" && appt.source === "schedicare"
        ? db
            .select()
            .from(schema.recommendations)
            .all()
            .find((r) => (r.payload as any)?.createdAppointmentId === appt.id)
        : undefined;
    if (holdRecommendation) {
      const doctor = getDoctor(appt.doctorId);
      const deleted = await deleteCalendarEvent(
        holdRecommendation.caseId,
        doctor.calendarId,
        appt.calendarEventId,
        "Patient declined or cancelled the temporary hold.",
      );
      if (!deleted) return err("Calendar could not release the hold; the appointment remains unchanged", 502);
    } else if (appt.calendarEventId) {
      const doctor = getDoctor(appt.doctorId);
      const pick = pickCalendarProvider();
      try {
        if (doctor.calendarId) await pick.provider.deleteEvent(doctor.calendarId, appt.calendarEventId);
      } catch (e) {
        if (pick.live) markCalendarUnhealthy(e);
      }
    }
    db.update(schema.appointments)
      .set({ status: "cancelled_by_patient" })
      .where(eq(schema.appointments.id, appt.id))
      .run();
    if (holdRecommendation) {
      const payload = holdRecommendation.payload as any;
      db.update(schema.recommendations)
        .set({ outcome: "declined" })
        .where(eq(schema.recommendations.id, holdRecommendation.id))
        .run();
      if (holdRecommendation.kind === "waitlist_fill" && payload.chosenWaitlistId) {
        db.update(schema.waitlist)
          .set({ status: "waiting" })
          .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
          .run();
      }
      maybeResolveCase(holdRecommendation.caseId, actor);
    }
    audit({ actor, action: "appointment.cancelled", refType: "appointment", refId: appt.id });
    // A future vacancy is worth recovering — open the backfill pipeline.
    if (appt.startUtc > demoNow().toISOString()) {
      enqueueEvent("patient_cancelled", { appointmentId: appt.id });
    }
    return json({ ok: true, status: "cancelled_by_patient", backfill: appt.startUtc > demoNow().toISOString() });
  }

  return err("unknown action");
}
