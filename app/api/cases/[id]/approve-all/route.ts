import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, eq } from "drizzle-orm";
import { demoNowIso } from "@/core/clock";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import { getCase, pendingRecommendationCounts, transitionCase } from "@/core/cases";
import { enqueueEvent } from "@/worker/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Approve every remaining proposed recommendation on the case (staff action). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  boot();
  const c = getCase(params.id);
  if (c.state !== "awaiting_approval") return err(`case is ${c.state}, not awaiting_approval`, 409);
  const proposed = db
    .select()
    .from(schema.recommendations)
    .where(and(eq(schema.recommendations.caseId, c.id), eq(schema.recommendations.status, "proposed")))
    .all();
  for (const rec of proposed) {
    db.update(schema.recommendations)
      .set({ status: "approved", decidedBy: "staff", decidedAt: demoNowIso(), decisionReason: "Approved all" })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    audit({ actor: "staff", action: "recommendation.approve", refType: "recommendation", refId: rec.id, caseId: c.id, detail: { via: "approve_all" } });
  }
  timeline(c.id, "staff", "decision", `Approved all ${proposed.length} remaining recommendation${proposed.length === 1 ? "" : "s"}`);
  const counts = pendingRecommendationCounts(c.id);
  if (counts.proposed === 0) {
    transitionCase(c.id, "executing", "staff", "All recommendations decided — executing approved actions.");
    enqueueEvent("execute_case", { caseId: c.id });
  }
  return json({ ok: true, approved: proposed.length });
}
