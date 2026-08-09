/**
 * PUT: staff edits to the extracted constraint set. Validated and
 * canonicalized before persisting; invalid sets are rejected with the issue
 * list so the editor can show exactly what's wrong.
 */
import { boot, err, json } from "@/lib/api";
import { getCase, updateCaseMeta } from "@/core/cases";
import { audit } from "@/core/audit";
import { demoNowIso } from "@/core/clock";
import {
  SchedulingConstraintSetSchema,
} from "@/core/constraints";
import { validateConstraintSet } from "@/core/constraintValidation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  boot();
  const c = getCase(params.id);
  const body = await req.json().catch(() => null);
  const parsed = SchedulingConstraintSetSchema.safeParse(body?.set);
  if (!parsed.success)
    return err(
      `invalid constraint set: ${parsed.error.issues[0]?.message ?? "schema"}`,
      422,
    );
  const v = validateConstraintSet(parsed.data);
  if (!v.ok)
    return json(
      { ok: false, errors: v.errors, warnings: v.warnings },
      { status: 422 },
    );
  const appointmentId: string | undefined = body?.appointmentId;
  if (!appointmentId) return err("appointmentId required", 422);
  const byAppt = ((c.meta as any) ?? {}).constraintsByAppt ?? {};
  const prior = byAppt[appointmentId] ?? {};
  updateCaseMeta(c.id, {
    constraintsByAppt: {
      ...byAppt,
      [appointmentId]: {
        ...prior,
        set: v.normalized,
        appointmentId,
        staffEditedAt: demoNowIso(),
        disposition: prior.disposition ?? "constraint_review",
        reviewedAt: prior.reviewedAt ?? null,
        reason: "staff-edited",
        validation: { ok: true, errors: [], warnings: v.warnings },
      },
    },
  });
  audit({
    actor: "staff",
    action: "constraints.edited",
    refType: "case",
    refId: c.id,
    caseId: c.id,
    detail: v.normalized,
  });
  return json({ ok: true, set: v.normalized, warnings: v.warnings });
}
