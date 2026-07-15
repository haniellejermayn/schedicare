import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { demoNow, demoNowIso, fmtWhen } from "@/core/clock";
import { validatePlacementNow } from "@/core/scheduling";
import { audit } from "@/core/audit";
import { pickCalendarProvider, markCalendarHealthy, markCalendarUnhealthy } from "@/integrations/factory";
import { SimulatedCalendarProvider } from "@/integrations/calendar/simulated";
import { getDoctor, getPatient } from "@/agents/tools";
import { addMinutes } from "date-fns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DUR: Record<string, number> = { routine: 30, follow_up: 20, urgent: 30 };

export async function GET(req: Request) {
  boot();
  const u = new URL(req.url);
  const patientId = u.searchParams.get("patientId");
  const doctorId = u.searchParams.get("doctorId");
  const upcomingOnly = u.searchParams.get("upcoming") === "1";
  let rows = db.select().from(schema.appointments).orderBy(asc(schema.appointments.startUtc)).all();
  if (patientId) rows = rows.filter((r) => r.patientId === patientId);
  if (doctorId) rows = rows.filter((r) => r.doctorId === doctorId);
  if (upcomingOnly) rows = rows.filter((r) => r.startUtc > demoNow().toISOString() && ["booked", "confirmed"].includes(r.status));
  const patients = db.select().from(schema.patients).all();
  const doctors = db.select().from(schema.doctors).all();
  return json({
    appointments: rows.map((r) => ({
      ...r,
      patientName: patients.find((p) => p.id === r.patientId)?.name ?? r.patientId,
      doctorName: doctors.find((d) => d.id === r.doctorId)?.name ?? r.doctorId,
    })),
  });
}

/**
 * Human action: the patient books directly. Direct write (not agent-mediated),
 * still validator-gated and fully audited.
 */
export async function POST(req: Request) {
  boot();
  const b = await body<{ patientId: string; doctorId: string; type: "routine" | "follow_up" | "urgent"; startUtc: string }>(req);
  if (!b.patientId || !b.doctorId || !b.type || !b.startUtc) return err("patientId, doctorId, type, startUtc are required");

  const check = await validatePlacementNow({ doctorId: b.doctorId, type: b.type, startUtc: b.startUtc });
  if (!check.ok) return err(`That slot is no longer available: ${check.reason}`, 409);

  const endUtc = addMinutes(new Date(b.startUtc), DUR[b.type]).toISOString();
  const appt = db
    .insert(schema.appointments)
    .values({
      clinicId: "clinic_riverside",
      doctorId: b.doctorId,
      patientId: b.patientId,
      type: b.type,
      startUtc: b.startUtc,
      endUtc,
      status: "confirmed", // self-booked patients confirm by booking
      bookedAt: demoNowIso(),
      source: "patient_app",
      createdAt: demoNowIso(),
    })
    .returning()
    .get();

  const doctor = getDoctor(b.doctorId);
  const patient = getPatient(b.patientId);
  let calendarLabel = "not written";
  if (doctor.calendarId) {
    const pick = pickCalendarProvider();
    try {
      const ev = await pick.provider.createEvent({
        calendarId: doctor.calendarId,
        summary: `${patient.name} — ${b.type.replace("_", " ")} (patient booking)`,
        description: `Booked via SchediCare patient app.`,
        startUtc: b.startUtc,
        endUtc,
      });
      if (pick.live) markCalendarHealthy();
      db.update(schema.appointments).set({ calendarEventId: ev.id }).where(eq(schema.appointments.id, appt.id)).run();
      calendarLabel = pick.live ? "Google Calendar" : "Simulated calendar";
    } catch (e) {
      if (pick.live) {
        markCalendarUnhealthy(e);
        const ev = await new SimulatedCalendarProvider().createEvent({
          calendarId: doctor.calendarId,
          summary: `${patient.name} — ${b.type.replace("_", " ")} (patient booking)`,
          description: "Booked via SchediCare patient app (fallback).",
          startUtc: b.startUtc,
          endUtc,
        });
        db.update(schema.appointments).set({ calendarEventId: ev.id }).where(eq(schema.appointments.id, appt.id)).run();
        calendarLabel = "Simulated calendar (Google unavailable)";
      }
    }
  }

  audit({
    actor: "patient",
    action: "appointment.booked",
    refType: "appointment",
    refId: appt.id,
    detail: { doctorId: b.doctorId, startUtc: b.startUtc, type: b.type, calendar: calendarLabel },
  });
  return json({ appointment: appt, calendar: calendarLabel, when: fmtWhen(appt.startUtc) });
}
