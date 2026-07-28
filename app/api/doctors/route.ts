import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const doctors = db
    .select()
    .from(schema.doctors)
    .orderBy(asc(schema.doctors.name))
    .all()
    .map((doctor) => ({
      id: doctor.id,
      name: doctor.name,
      initials: doctor.initials,
      specialty: doctor.specialty,
    }));
  return json({ doctors });
}
