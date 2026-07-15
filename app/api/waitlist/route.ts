import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const rows = db.select().from(schema.waitlist).orderBy(asc(schema.waitlist.addedAt)).all();
  const patients = db.select().from(schema.patients).all();
  const doctors = db.select().from(schema.doctors).all();
  const waitlist = rows.map((w) => ({
    ...w,
    patientName: patients.find((p) => p.id === w.patientId)?.name ?? w.patientId,
    doctorName: w.doctorId ? doctors.find((d) => d.id === w.doctorId)?.name ?? null : null,
  }));
  return json({ waitlist });
}
