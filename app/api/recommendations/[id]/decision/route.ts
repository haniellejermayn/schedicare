import { boot, body, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { and, eq } from "drizzle-orm";
import { demoNowIso } from "@/core/clock";
import { audit } from "@/core/audit";
import { timeline } from "@/core/timeline";
import { getCase, pendingRecommendationCounts, transitionCase } from "@/core/cases";
import { enqueueEvent } from "@/worker/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * THE approval gate. Only this endpoint (and approve-all, which calls the same
 * logic) moves recommendations out of `proposed`, and only when no proposals
 * remain does the case transition to `executing` — always with actor "staff".
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  boot();
  const b = await body<{ action: "approve" | "modify" | "reject"; optionId?: string; reason?: string }>(req);
  const rec = db.select().from(schema.recommendations).where(eq(schema.recommendations.id, params.id)).get();
  if (!rec) return err("recommendation not found", 404);
  if (rec.status !== "proposed") return err(`recommendation already ${rec.status}`, 409);
  const c = getCase(rec.caseId);
  if (c.state !== "awaiting_approval") return err(`case is ${c.state}, not awaiting_approval`, 409);

  const payload = rec.payload as any;

  if (b.action === "approve") {
    db.update(schema.recommendations)
      .set({ status: "approved", decidedBy: "staff", decidedAt: demoNowIso() })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(rec.caseId, "staff", "decision", `Approved: ${payload.patientName ?? rec.kind}`, undefined, { recommendationId: rec.id });
  } else if (b.action === "modify") {
    if (!b.optionId) return err("modify requires optionId");
    const valid = (payload.options ?? []).some((o: any) => o.id === b.optionId);
    if (!valid) return err("optionId must be one of the validator-approved options on this recommendation", 422);
    db.update(schema.recommendations)
      .set({
        status: "modified",
        decidedBy: "staff",
        decidedAt: demoNowIso(),
        decisionReason: b.reason ?? "Staff chose a different validated option",
        payload: { ...payload, modifiedOptionId: b.optionId },
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    const opt = (payload.options ?? []).find((o: any) => o.id === b.optionId);
    timeline(rec.caseId, "staff", "decision", `Modified: ${payload.patientName ?? rec.kind} → ${opt?.day ?? ""} option`, b.reason, { recommendationId: rec.id });
  } else if (b.action === "reject") {
    if (!b.reason || b.reason.trim().length < 3) return err("reject requires a reason");
    db.update(schema.recommendations)
      .set({ status: "rejected", decidedBy: "staff", decidedAt: demoNowIso(), decisionReason: b.reason.trim() })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(rec.caseId, "staff", "decision", `Rejected: ${payload.patientName ?? rec.kind}`, b.reason.trim(), { recommendationId: rec.id });
  } else {
    return err("action must be approve, modify, or reject");
  }

  audit({ actor: "staff", action: `recommendation.${b.action}`, refType: "recommendation", refId: rec.id, caseId: rec.caseId, detail: { optionId: b.optionId, reason: b.reason } });

  // When every recommendation is decided, staff's decision moves the case forward.
  const counts = pendingRecommendationCounts(rec.caseId);
  let transitioned = false;
  if (counts.proposed === 0) {
    transitionCase(rec.caseId, "executing", "staff", "All recommendations decided — executing approved actions.");
    enqueueEvent("resume_case", { caseId: rec.caseId });
    transitioned = true;
  }
  return json({ ok: true, transitioned, remainingProposed: counts.proposed });
}
