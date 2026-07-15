import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { RuleSetSchema } from "@/core/types";
import { setRules } from "@/core/rules";
import { audit } from "@/core/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Doctor edits their own scheduling rules (validated by RuleSetSchema). */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  boot();
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, params.id)).get();
  if (!doctor) return err("doctor not found", 404);
  const parsed = RuleSetSchema.safeParse(await body(req));
  if (!parsed.success) return err(`invalid rules: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, 422);
  setRules(doctor.id, parsed.data);
  audit({ actor: "doctor", action: "rules.updated", refType: "doctor", refId: doctor.id, detail: parsed.data });
  return json({ ok: true, rules: parsed.data });
}
