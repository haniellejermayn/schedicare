import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, desc, eq } from "drizzle-orm";
import {
  getCase,
  maybeResolveCase,
  pendingConstraintReviews,
  updateCaseMeta,
} from "@/core/cases";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/worker/executor";
import { getDoctor, getPatient } from "@/agents/tools";
import { validatePlacementNow } from "@/core/scheduling";
import { getRules } from "@/core/rules";
import { demoNowIso, fmtWhen } from "@/core/clock";
import { addMinutes } from "date-fns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "accept_current" | "decline" | "choose_another" | "no_answer";

export async function POST(
  req: Request,
  { params }: { params: { id: string; patientId: string } },
) {
  boot();
  const input = await body<{ action?: Action; startUtc?: string }>(req);
  if (!["accept_current", "decline", "choose_another", "no_answer"].includes(input.action ?? "")) {
    return err("unknown follow-up action");
  }

  const c = getCase(params.id);
  if (pendingConstraintReviews(c.id, { patientId: params.patientId }).length > 0)
    return err(
      "Required constraint review must be completed before acting on this patient.",
      409,
    );
  const patient = getPatient(params.patientId);
  const rec = db
    .select()
    .from(schema.recommendations)
    .where(
      and(
        eq(schema.recommendations.caseId, c.id),
        eq(schema.recommendations.patientId, patient.id),
      ),
    )
    .orderBy(desc(schema.recommendations.createdAt))
    .all()
    .find((r) => r.outcome !== "superseded");
  if (!rec) return err("no patient item found in this case", 404);

  const payload = (rec.payload as any) ?? {};
  const appointmentId = payload.createdAppointmentId ?? payload.appointmentId;
  const appointment = appointmentId
    ? db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).get()
    : undefined;
  const activeHold =
    appointment?.status === "booked" && appointment.source === "schedicare"
      ? appointment
      : undefined;

  const clearCallback = (target = appointment) => {
    if (target) {
      db.update(schema.appointments)
        .set({ needsCallback: false })
        .where(eq(schema.appointments.id, target.id))
        .run();
    }
    const meta = (getCase(c.id).meta as any) ?? {};
    if (Array.isArray(meta.needsCallback)) {
      updateCaseMeta(c.id, {
        needsCallback: meta.needsCallback.filter((item: any) => item.patientId !== patient.id),
      });
    }
  };

  if (input.action === "no_answer") {
    timeline(c.id, "staff", "decision", `${patient.name}: no answer — follow up later`, undefined, {
      patientId: patient.id,
      recommendationId: rec.id,
    });
    audit({
      actor: "staff",
      action: "patient.follow_up_no_answer",
      refType: "recommendation",
      refId: rec.id,
      caseId: c.id,
      detail: { patientId: patient.id },
    });
    return json({ ok: true, outcome: "no_answer", resolved: false });
  }

  if (input.action === "accept_current") {
    if (!activeHold) return err("this patient has no active temporary hold", 409);
    const doctor = getDoctor(activeHold.doctorId);
    const calendarUpdated = await updateCalendarEvent(
      c.id,
      doctor.calendarId,
      activeHold.calendarEventId,
      {
        summary: `${patient.name} — ${activeHold.type.replace("_", " ")}`,
        description: `Confirmed by clinic staff after patient follow-up. Case ${c.id}.`,
      },
    );
    if (!calendarUpdated) return err("Calendar could not confirm the hold; the item remains unresolved", 502);

    db.update(schema.appointments)
      .set({ status: "confirmed", needsCallback: false })
      .where(eq(schema.appointments.id, activeHold.id))
      .run();
    if (rec.kind === "waitlist_fill" && payload.chosenWaitlistId) {
      db.update(schema.waitlist)
        .set({ status: "scheduled" })
        .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
        .run();
    }
    db.update(schema.recommendations)
      .set({ outcome: "accepted" })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    clearCallback(activeHold);
    timeline(c.id, "staff", "effect", `${patient.name}: confirmed the temporary hold`, undefined, {
      patientId: patient.id,
      appointmentId: activeHold.id,
    });
    audit({
      actor: "staff",
      action: "appointment.confirmed_after_follow_up",
      refType: "appointment",
      refId: activeHold.id,
      caseId: c.id,
      detail: { patientId: patient.id },
    });
  }

  if (input.action === "decline") {
    if (activeHold) {
      const deleted = await deleteCalendarEvent(
        c.id,
        getDoctor(activeHold.doctorId).calendarId,
        activeHold.calendarEventId,
        "Patient declined the temporary hold during staff follow-up.",
      );
      if (!deleted) return err("Calendar could not release the hold; the item remains unresolved", 502);

      db.update(schema.appointments)
        .set({ status: "cancelled_by_patient", needsCallback: false })
        .where(eq(schema.appointments.id, activeHold.id))
        .run();
      if (rec.kind === "waitlist_fill" && payload.chosenWaitlistId) {
        db.update(schema.waitlist)
          .set({ status: "waiting" })
          .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
          .run();
      }
      db.update(schema.recommendations)
        .set({ outcome: "released" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      clearCallback(activeHold);
      timeline(c.id, "staff", "effect", `${patient.name}: declined; temporary hold released`, undefined, {
        patientId: patient.id,
        appointmentId: activeHold.id,
      });
      audit({
        actor: "staff",
        action: "appointment.hold_declined",
        refType: "appointment",
        refId: activeHold.id,
        caseId: c.id,
        detail: { patientId: patient.id },
      });
    } else {
      db.update(schema.recommendations)
        .set({ outcome: "handled" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      clearCallback();
      timeline(c.id, "staff", "decision", `${patient.name}: declined; handled manually`, undefined, {
        patientId: patient.id,
        recommendationId: rec.id,
      });
      audit({
        actor: "staff",
        action: "patient.declined_manually",
        refType: "recommendation",
        refId: rec.id,
        caseId: c.id,
        detail: { patientId: patient.id },
      });
    }
  }

  if (input.action === "choose_another") {
    if (!appointment) return err("this patient has no appointment context", 409);
    if (!input.startUtc) return err("startUtc is required");
    const activeAppointment = ["booked", "confirmed"].includes(appointment.status)
      ? appointment
      : undefined;
    const check = await validatePlacementNow({
      doctorId: appointment.doctorId,
      type: appointment.type,
      startUtc: input.startUtc,
      ignoreAppointmentId: activeAppointment?.id,
    });
    if (!check.ok) return err(`That slot is no longer available: ${check.reason}`, 409);

    const doctor = getDoctor(appointment.doctorId);
    const durationMin = getRules(appointment.doctorId).durationMin[appointment.type];
    if (!durationMin) return err(`doctor has no duration configured for ${appointment.type}`, 409);
    const endUtc = addMinutes(new Date(input.startUtc), durationMin).toISOString();
    const created = await createCalendarEvent(c.id, {
      calendarId: doctor.calendarId,
      summary: `${patient.name} — ${appointment.type.replace("_", " ")} (front desk)`,
      description: `Confirmed by the front desk after patient follow-up. Case ${c.id}.`,
      startUtc: input.startUtc,
      endUtc,
    });
    if (doctor.calendarId && !created.eventId) {
      return err("Calendar could not create the replacement; the item remains unresolved", 502);
    }

    const replacement = db
      .insert(schema.appointments)
      .values({
        clinicId: appointment.clinicId,
        doctorId: appointment.doctorId,
        patientId: patient.id,
        type: appointment.type,
        startUtc: input.startUtc,
        endUtc,
        status: "confirmed",
        calendarEventId: created.eventId,
        bookedAt: demoNowIso(),
        source: "front_desk",
        createdAt: demoNowIso(),
      })
      .returning()
      .get();

    if (activeAppointment) {
      const deleted = await deleteCalendarEvent(
        c.id,
        doctor.calendarId,
        activeAppointment.calendarEventId,
        `Appointment replaced by front-desk booking at ${fmtWhen(input.startUtc)}.`,
      );
      if (!deleted) {
        db.update(schema.appointments)
          .set({ status: "cancelled_by_doctor" })
          .where(eq(schema.appointments.id, replacement.id))
          .run();
        await deleteCalendarEvent(
          c.id,
          doctor.calendarId,
          replacement.calendarEventId,
          "Replacement rolled back because the original hold could not be released.",
        );
        return err("Calendar could not release the original hold; the item remains unresolved", 502);
      }
      db.update(schema.appointments)
        .set({ status: "superseded", supersededBy: replacement.id, needsCallback: false })
        .where(eq(schema.appointments.id, activeAppointment.id))
        .run();
    }

    if (rec.kind === "waitlist_fill" && payload.chosenWaitlistId) {
      db.update(schema.waitlist)
        .set({ status: "scheduled" })
        .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
        .run();
    }
    db.update(schema.recommendations)
      .set({
        outcome: "accepted",
        payload: {
          ...payload,
          replacedAppointmentId: appointment.id,
          createdAppointmentId: replacement.id,
        },
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    clearCallback(appointment);
    timeline(c.id, "staff", "effect", `${patient.name}: moved to ${fmtWhen(input.startUtc)}`, undefined, {
      patientId: patient.id,
      appointmentId: replacement.id,
    });
    audit({
      actor: "staff",
      action: "appointment.rescheduled_after_follow_up",
      refType: "appointment",
      refId: replacement.id,
      caseId: c.id,
      detail: {
        patientId: patient.id,
        fromAppointmentId: appointment.id,
        startUtc: input.startUtc,
      },
    });
  }

  const resolved = maybeResolveCase(c.id, "staff");
  return json({ ok: true, outcome: input.action, resolved });
}
