import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, desc, eq } from "drizzle-orm";
import { getCase, maybeResolveCase, updateCaseMeta } from "@/core/cases";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import { deleteCalendarEvent } from "@/worker/executor";
import { getDoctor, getPatient } from "@/agents/tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Action = "mark_called" | "mark_handled" | "release_hold";

export async function POST(
  req: Request,
  { params }: { params: { id: string; patientId: string } },
) {
  boot();
  const input = await body<{ action?: Action }>(req);
  if (!["mark_called", "mark_handled", "release_hold"].includes(input.action ?? "")) {
    return err("action must be mark_called, mark_handled, or release_hold");
  }

  const c = getCase(params.id);
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

  if (input.action === "release_hold") {
    if (!appointment || appointment.status !== "booked") {
      return err("this patient has no active hold", 409);
    }
    await deleteCalendarEvent(
      c.id,
      getDoctor(appointment.doctorId).calendarId,
      appointment.calendarEventId,
      "Released manually by front-desk staff.",
    );
    db.update(schema.appointments)
      .set({ status: "cancelled_by_doctor", needsCallback: false })
      .where(eq(schema.appointments.id, appointment.id))
      .run();
    db.update(schema.recommendations)
      .set({ outcome: "released" })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(c.id, "staff", "effect", `${patient.name}: temporary hold released`, undefined, {
      patientId: patient.id,
      appointmentId: appointment.id,
    });
    audit({
      actor: "staff",
      action: "appointment.hold_released",
      refType: "appointment",
      refId: appointment.id,
      caseId: c.id,
      detail: { patientId: patient.id },
    });
  } else {
    const outcome = input.action === "mark_called" ? "called" : "handled";
    db.update(schema.recommendations)
      .set({ outcome })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    if (appointment) {
      db.update(schema.appointments)
        .set({ needsCallback: false })
        .where(eq(schema.appointments.id, appointment.id))
        .run();
    }
    const meta = (c.meta as any) ?? {};
    if (Array.isArray(meta.needsCallback)) {
      updateCaseMeta(c.id, {
        needsCallback: meta.needsCallback.filter((item: any) => item.patientId !== patient.id),
      });
    }
    const title =
      input.action === "mark_called"
        ? `${patient.name}: called by staff`
        : `${patient.name}: handled manually`;
    timeline(c.id, "staff", "decision", title, undefined, { patientId: patient.id });
    audit({
      actor: "staff",
      action: input.action === "mark_called" ? "patient.marked_called" : "patient.marked_handled",
      refType: "recommendation",
      refId: rec.id,
      caseId: c.id,
      detail: { patientId: patient.id },
    });
  }

  const resolved = maybeResolveCase(c.id, "staff");
  return json({ ok: true, outcome: input.action, resolved });
}
