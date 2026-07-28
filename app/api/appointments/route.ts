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
import { getRules } from "@/core/rules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const b = await body<{
    patientId: string;
    doctorId: string;
    type: "routine" | "follow_up" | "urgent";
    startUtc: string;
    bookedBy?: "patient" | "staff";
  }>(req);
  if (!b.patientId || !b.doctorId || !b.type || !b.startUtc) return err("patientId, doctorId, type, startUtc are required");
  if (!["routine", "follow_up", "urgent"].includes(b.type)) return err("unknown appointment type");
  if (!db.select().from(schema.patients).where(eq(schema.patients.id, b.patientId)).get()) return err("patient not found", 404);
  if (!db.select().from(schema.doctors).where(eq(schema.doctors.id, b.doctorId)).get()) return err("doctor not found", 404);

  const check = await validatePlacementNow({ doctorId: b.doctorId, type: b.type, startUtc: b.startUtc });
  if (!check.ok) return err(`That slot is no longer available: ${check.reason}`, 409);

  const bookedBy = b.bookedBy === "staff" ? "staff" : "patient";
  const durationMin = getRules(b.doctorId).durationMin[b.type];
  if (!durationMin) return err(`doctor has no duration configured for ${b.type}`, 409);
  const endUtc = addMinutes(new Date(b.startUtc), durationMin).toISOString();
  const appt = db
    .insert(schema.appointments)
    .values({
      clinicId: "clinic_riverside",
      doctorId: b.doctorId,
      patientId: b.patientId,
      type: b.type,
      startUtc: b.startUtc,
      endUtc,
      status: "confirmed",
      bookedAt: demoNowIso(),
      source: bookedBy === "staff" ? "front_desk" : "patient_app",
      createdAt: demoNowIso(),
    })
    .returning()
    .get();

  const doctor = getDoctor(b.doctorId);
  const patient = getPatient(b.patientId);
  const sourceLabel = bookedBy === "staff" ? "front desk" : "patient app";
  let calendarLabel = "not written";
  if (doctor.calendarId) {
    const pick = pickCalendarProvider();
    try {
      const ev = await pick.provider.createEvent({
        calendarId: doctor.calendarId,
        summary: `${patient.name} — ${b.type.replace("_", " ")} (${sourceLabel})`,
        description: `Booked via SchediCare ${sourceLabel}.`,
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
          summary: `${patient.name} — ${b.type.replace("_", " ")} (${sourceLabel})`,
          description: `Booked via SchediCare ${sourceLabel} (fallback).`,
          startUtc: b.startUtc,
          endUtc,
        });
        db.update(schema.appointments).set({ calendarEventId: ev.id }).where(eq(schema.appointments.id, appt.id)).run();
        calendarLabel = "Simulated calendar (Google unavailable)";
      }
    }
  }

  audit({
    actor: bookedBy,
    action: "appointment.booked",
    refType: "appointment",
    refId: appt.id,
    detail: { doctorId: b.doctorId, startUtc: b.startUtc, type: b.type, source: appt.source, calendar: calendarLabel },
  });
  return json({ appointment: appt, calendar: calendarLabel, when: fmtWhen(appt.startUtc) });
}
