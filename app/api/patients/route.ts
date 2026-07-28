import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc } from "drizzle-orm";
import { id } from "@/core/ids";
import { demoNowIso } from "@/core/clock";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const patients = db.select().from(schema.patients).orderBy(asc(schema.patients.name)).all();
  return json({ patients });
}

export async function POST(req: Request) {
  boot();
  const input = await body<{ name?: string; email?: string; phone?: string }>(req);
  const name = input.name?.trim();
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim() || null;
  if (!name || !email) return err("name and email are required");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("enter a valid email address");

  const patient = db
    .insert(schema.patients)
    .values({
      id: `pat_${id(10)}`,
      clinicId: "clinic_riverside",
      name,
      email,
      phone,
      prefDayPart: "any",
      staffPriority: 0,
      createdAt: demoNowIso(),
    })
    .returning()
    .get();
  audit({
    actor: "staff",
    action: "patient.created",
    refType: "patient",
    refId: patient.id,
    detail: { name: patient.name, email: patient.email },
  });
  return json({ patient }, { status: 201 });
}
