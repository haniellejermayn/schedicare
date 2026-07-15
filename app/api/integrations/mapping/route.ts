import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Map a doctor to a Google (or simulated) calendar id. */
export async function POST(req: Request) {
  boot();
  const b = await body<{ doctorId: string; calendarId: string }>(req);
  if (!b.doctorId || !b.calendarId) return err("doctorId and calendarId are required");
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, b.doctorId)).get();
  if (!doctor) return err("doctor not found", 404);
  db.update(schema.doctors).set({ calendarId: b.calendarId.trim() }).where(eq(schema.doctors.id, b.doctorId)).run();
  audit({ actor: "staff", action: "integration.mapping_updated", refType: "doctor", refId: b.doctorId, detail: { calendarId: b.calendarId.trim() } });
  return json({ ok: true });
}
