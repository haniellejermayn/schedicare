import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { addDays } from "date-fns";
import { demoNow, demoToday } from "@/core/clock";
import { getRules } from "@/core/rules";
import { scoreNoShowRisk } from "@/core/risk";
import { patientHistory } from "@/agents/tools";
import { getBusyIntervals } from "@/integrations/factory";
import { demoCascadeDay } from "@/sim/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, params.id)).get();
  if (!doctor) return err("doctor not found", 404);
  const rules = getRules(doctor.id);
  const appts = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.doctorId, doctor.id))
    .orderBy(asc(schema.appointments.startUtc))
    .all();
  const patients = db.select().from(schema.patients).all();
  const upcoming = appts.filter((a) => ["booked", "confirmed"].includes(a.status) && a.startUtc > demoNow().toISOString());
  const atRisk = upcoming
    .map((a) => {
      const p = patients.find((x) => x.id === a.patientId)!;
      const risk = scoreNoShowRisk({ status: a.status, startUtc: a.startUtc, bookedAt: a.bookedAt, now: demoNow(), history: patientHistory(a.patientId) });
      return { appointmentId: a.id, patientName: p?.name ?? a.patientId, startUtc: a.startUtc, type: a.type, status: a.status, ...risk };
    })
    .filter((r) => r.band !== "low")
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  /**
   * External busy blocks: whatever the doctor's real Google Calendar (or its
   * simulated twin) shows as busy that ISN'T already one of our own tracked
   * appointments — e.g. "Barangay health outreach", personal blocks, other
   * clinics. freebusy.query only ever returns time ranges (no title/summary),
   * so this is rendered honestly downstream as anonymous "Busy" stripes, not
   * fabricated event names. Window: yesterday through +14 days, covering both
   * the Today and This-week tabs without hardcoding a specific demo date.
   */
  const rangeStart = addDays(demoNow(), -1).toISOString();
  const rangeEnd = addDays(demoNow(), 14).toISOString();
  const rawBusy = doctor.calendarId ? await getBusyIntervals(doctor.calendarId, { startUtc: rangeStart, endUtc: rangeEnd }) : [];
  const knownIntervals = appts
    .filter((a) => ["booked", "confirmed"].includes(a.status))
    .map((a) => ({ startUtc: a.startUtc, endUtc: a.endUtc }));
  const externalBusy = rawBusy.filter(
    (b) => !knownIntervals.some((k) => k.startUtc === b.startUtc || (b.startUtc >= k.startUtc && b.endUtc <= k.endUtc))
  );

  return json({
    doctor,
    demoToday: demoToday(),
    showcaseDay: demoCascadeDay(),
    rules,
    appointments: appts.map((a) => ({ ...a, patientName: patients.find((p) => p.id === a.patientId)?.name ?? a.patientId })),
    atRisk,
    externalBusy,
  });
}
