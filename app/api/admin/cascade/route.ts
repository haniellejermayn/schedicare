import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";
import { enqueueEvent } from "@/worker/queue";
import { SANTOS, DEMO_DAY } from "@/sim/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Admin shortcut: trigger the flagship Dr. Santos emergency cascade. */
export async function POST() {
  boot();
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, SANTOS)).get();
  if (!doctor) return err("seed data missing — run Reset Demo first", 409);
  if ((doctor.unavailableDates ?? []).includes(DEMO_DAY)) {
    return err("Dr. Santos is already marked unavailable today — Reset Demo to run the cascade again", 409);
  }
  db.update(schema.doctors)
    .set({ status: "unavailable", unavailableDates: [...(doctor.unavailableDates ?? []), DEMO_DAY] })
    .where(eq(schema.doctors.id, SANTOS))
    .run();
  audit({ actor: "staff", action: "doctor.marked_unavailable", refType: "doctor", refId: SANTOS, detail: { date: DEMO_DAY, via: "admin_cascade" } });
  const eventId = enqueueEvent("doctor_emergency", { doctorId: SANTOS, date: DEMO_DAY, reason: "Family emergency — out for the day" });
  return json({ ok: true, eventId });
}
