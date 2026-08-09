import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { enqueueEvent } from "@/worker/queue";
import {
  pickCalendarProvider,
  markCalendarUnhealthy,
} from "@/integrations/factory";
import { fromZonedTime } from "date-fns-tz";
import { CLINIC_TZ } from "@/core/env";
import { demoToday } from "@/core/clock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The Emergency Unavailability button. A human (the doctor) marks a day out:
 * direct writes + an out-of-office calendar block, fully audited, then a
 * doctor_emergency event kicks off the agent cascade.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const b = await body<{ date?: string; reason?: string }>(req);
  const date = b.date ?? demoToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err("date must be yyyy-MM-dd");
  if (date < demoToday()) return err("that date is already past");
  const doctor = db
    .select()
    .from(schema.doctors)
    .where(eq(schema.doctors.id, params.id))
    .get();
  if (!doctor) return err("doctor not found", 404);
  if ((doctor.unavailableDates ?? []).includes(date))
    return err(`already marked unavailable for ${date}`, 409);

  // How many booked/confirmed visits that day will need rebooking — shown to
  // the doctor in the confirmation message.
  const affected = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.doctorId, doctor.id))
    .all()
    .filter(
      (a) =>
        ["booked", "confirmed"].includes(a.status) &&
        new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
          new Date(a.startUtc),
        ) === date,
    ).length;

  const dates = [...(doctor.unavailableDates ?? []), date];
  db.update(schema.doctors)
    .set({ status: "unavailable", unavailableDates: dates })
    .where(eq(schema.doctors.id, doctor.id))
    .run();
  audit({
    actor: "doctor",
    action: "doctor.marked_unavailable",
    refType: "doctor",
    refId: doctor.id,
    detail: { date, reason: b.reason },
  });

  // Out-of-office block on the doctor's calendar (human-initiated effect).
  let calendarLabel = "not written";
  if (doctor.calendarId) {
    const pick = pickCalendarProvider();
    try {
      await pick.provider.createEvent({
        calendarId: doctor.calendarId,
        summary: `OUT OF OFFICE — ${doctor.name}`,
        description: b.reason ?? "Emergency unavailability (SchediCare)",
        startUtc: fromZonedTime(`${date}T08:00:00`, CLINIC_TZ).toISOString(),
        endUtc: fromZonedTime(`${date}T17:00:00`, CLINIC_TZ).toISOString(),
      });
      calendarLabel = pick.live ? "Google Calendar" : "Simulated calendar";
    } catch (e) {
      if (pick.live) markCalendarUnhealthy(e);
      calendarLabel = "failed (recorded in audit log)";
    }
  }

  const eventId = enqueueEvent("doctor_emergency", {
    doctorId: doctor.id,
    date,
    reason: b.reason ?? "emergency",
  });
  return json({ ok: true, date, affected, calendar: calendarLabel, eventId });
}
