import { boot, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { desc } from "drizzle-orm";
import { caseScoreboard } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  boot();
  const cases = db.select().from(schema.cases).orderBy(desc(schema.cases.createdAt)).all();
  const recs = db.select().from(schema.recommendations).all();
  return json({
    cases: cases.map((c) => ({
      ...c,
      pendingCount: recs.filter((r) => r.caseId === c.id && r.status === "proposed").length,
      recCount: recs.filter((r) => r.caseId === c.id).length,
      scoreboard: caseScoreboard(c.id),
    })),
  });
}
