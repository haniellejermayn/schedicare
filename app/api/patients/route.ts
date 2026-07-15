import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const patients = db.select().from(schema.patients).orderBy(asc(schema.patients.name)).all();
  return json({ patients });
}
