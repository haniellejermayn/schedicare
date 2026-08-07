/**
 * POST: staff approves the constraint set (optionally choosing a specific
 * slot) — enqueues the constraint replan. The offer itself still lands as a
 * normal recommendation behind the existing approval gate; this endpoint
 * never books anything.
 */
import { boot, err, json } from "@/lib/api";
import { getCase, updateCaseMeta } from "@/core/cases";
import { audit } from "@/core/audit";
import { demoNowIso } from "@/core/clock";
import { SchedulingConstraintSetSchema } from "@/core/constraints";
import { validateConstraintSet } from "@/core/constraintValidation";
import { enqueueEvent } from "@/worker/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const c = getCase(params.id);
  const body = await req.json().catch(() => null);
  const parsed = SchedulingConstraintSetSchema.safeParse(body?.set);
  if (!parsed.success) return err("invalid constraint set", 422);
  if (!body?.appointmentId || !body?.supersededRecId)
    return err("appointmentId and supersededRecId required", 422);
  const v = validateConstraintSet(parsed.data);
  if (!v.ok) return json({ ok: false, errors: v.errors }, { status: 422 });
  const prior = ((c.meta as any) ?? {}).latestConstraints ?? {};
  updateCaseMeta(c.id, {
    latestConstraints: {
      ...prior,
      set: v.normalized,
      staffApprovedAt: demoNowIso(),
      disposition: "approved",
    },
  });
  audit({
    actor: "staff",
    action: "constraints.approved",
    refType: "case",
    refId: c.id,
    caseId: c.id,
    detail: { set: v.normalized, chosenSlot: body.chosenSlot ?? null },
  });
  const eventId = enqueueEvent("constraint_replan", {
    caseId: c.id,
    appointmentId: body.appointmentId,
    supersededRecId: body.supersededRecId,
    set: v.normalized,
    note: "Staff approved extracted constraints",
    chosenSlot: body.chosenSlot ?? undefined,
  });
  return json({ ok: true, eventId });
}
