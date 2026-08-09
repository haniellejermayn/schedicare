import { eq } from "drizzle-orm";
import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { demoToday, manilaDate } from "@/core/clock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only counts + per-patient detail lists for the front-desk
 * mini-dashboard. The waiting/toCall lists mirror lib/metrics.ts
 * caseScoreboard rule-for-rule so the tile numbers and expanded lists can
 * never disagree.
 */
export async function GET() {
  boot();
  const today = demoToday();
  const patients = new Map(
    db
      .select()
      .from(schema.patients)
      .all()
      .map((p) => [p.id, p.name] as const),
  );
  const doctors = db.select().from(schema.doctors).all();
  const doctorName = new Map(doctors.map((d) => [d.id, d.name] as const));

  const visits = db
    .select()
    .from(schema.appointments)
    .all()
    .filter(
      (a) =>
        ["booked", "confirmed"].includes(a.status) &&
        manilaDate(a.startUtc) === today,
    )
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map((a) => ({
      id: a.id,
      startUtc: a.startUtc,
      patientName: patients.get(a.patientId) ?? a.patientId,
      doctorName: doctorName.get(a.doctorId) ?? a.doctorId,
      type: a.type,
      status: a.status,
    }));
  const confirmed = visits.filter((v) => v.status === "confirmed").length;

  const doctorsOut = doctors
    .filter((d) => (d.unavailableDates ?? []).includes(today))
    .map((d) => d.name);

  // Per-patient waiting / to-call across every case that's still moving.
  const activeCases = db
    .select()
    .from(schema.cases)
    .all()
    .filter((c) => c.state !== "resolved");
  const waiting: Array<{ patientName: string; when: string; caseId: string }> =
    [];
  const toCall: Array<{ patientName: string; reason: string; caseId: string }> =
    [];
  for (const c of activeCases) {
    const recs = db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.caseId, c.id))
      .all();
    for (const r of recs.filter(
      (x) => x.kind === "reschedule" || x.kind === "waitlist_fill",
    )) {
      const payload = r.payload as any;
      const name =
        patients.get(payload?.patientId) ?? payload?.patientId ?? "Patient";
      if (
        r.status === "executed" &&
        r.outcome !== "superseded" &&
        payload?.createdAppointmentId
      ) {
        const appt = db
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, payload.createdAppointmentId))
          .get();
        if (appt?.status === "booked")
          waiting.push({
            patientName: name,
            when: appt.startUtc,
            caseId: c.id,
          });
        if (appt?.status === "cancelled_by_patient")
          toCall.push({
            patientName: name,
            reason: "cancelled the new time",
            caseId: c.id,
          });
      }
      if (r.outcome === "needs_human")
        toCall.push({
          patientName: name,
          reason: "reply needs a person",
          caseId: c.id,
        });
      else if (r.status === "rejected")
        toCall.push({
          patientName: name,
          reason: "suggestion was rejected",
          caseId: c.id,
        });
    }
  }

  return json({
    today,
    visitsToday: visits.length,
    confirmedToday: confirmed,
    unconfirmedToday: visits.length - confirmed,
    visits,
    doctorsOut,
    waiting,
    toCall,
  });
}
