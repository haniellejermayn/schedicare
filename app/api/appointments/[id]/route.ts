import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { enqueueEvent } from "@/worker/queue";
import { pickCalendarProvider, markCalendarUnhealthy } from "@/integrations/factory";
import { getDoctor } from "@/agents/tools";
import { demoNow } from "@/core/clock";

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
    db.update(schema.appointments).set({ status: "confirmed" }).where(eq(schema.appointments.id, appt.id)).run();
    audit({ actor, action: "appointment.confirmed", refType: "appointment", refId: appt.id });
    return json({ ok: true, status: "confirmed" });
  }

  if (b.action === "cancel") {
    if (!["booked", "confirmed"].includes(appt.status)) return err(`cannot cancel a ${appt.status} appointment`, 409);
    db.update(schema.appointments).set({ status: "cancelled_by_patient" }).where(eq(schema.appointments.id, appt.id)).run();
    if (appt.calendarEventId) {
      const doctor = getDoctor(appt.doctorId);
      const pick = pickCalendarProvider();
      try {
        if (doctor.calendarId) await pick.provider.deleteEvent(doctor.calendarId, appt.calendarEventId);
      } catch (e) {
        if (pick.live) markCalendarUnhealthy(e);
      }
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
