import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { demoNow } from "@/core/clock";
import { getRules } from "@/core/rules";
import { scoreNoShowRisk } from "@/core/risk";
import { patientHistory } from "@/agents/tools";

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

  return json({
    doctor,
    rules,
    appointments: appts.map((a) => ({ ...a, patientName: patients.find((p) => p.id === a.patientId)?.name ?? a.patientId })),
    atRisk,
  });
}
