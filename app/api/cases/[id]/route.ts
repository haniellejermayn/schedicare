import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { asc, eq } from "drizzle-orm";
import { caseScoreboard } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const c = db.select().from(schema.cases).where(eq(schema.cases.id, params.id)).get();
  if (!c) return err("case not found", 404);
  const recommendations = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, c.id))
    .orderBy(asc(schema.recommendations.createdAt))
    .all();
  const messages = db.select().from(schema.messages).where(eq(schema.messages.caseId, c.id)).orderBy(asc(schema.messages.createdAt)).all();
  const timeline = db.select().from(schema.caseTimeline).where(eq(schema.caseTimeline.caseId, c.id)).orderBy(asc(schema.caseTimeline.id)).all();
  return json({ case: c, recommendations, messages, timeline, scoreboard: caseScoreboard(c.id) });
}
