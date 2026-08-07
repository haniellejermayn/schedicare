/**
 * POST: run the deterministic constraint search for the editor's preview.
 * Read-only — no holds, no drafts. Returns scored slots with soft-preference
 * chips and doctor names for display.
 */
import { eq } from "drizzle-orm";
import { boot, err, json } from "@/lib/api";
import { db, schema } from "@/core/db/client";
import { getCase } from "@/core/cases";
import { SchedulingConstraintSetSchema } from "@/core/constraints";
import { validateConstraintSet } from "@/core/constraintValidation";
import { findSlotsForConstraints } from "@/core/constraintMatching";

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
  const appointmentId: string | undefined = body?.appointmentId;
  if (!appointmentId) return err("appointmentId required", 422);
  const appt = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, appointmentId))
    .get();
  if (!appt) return err("appointment not found", 404);
  const v = validateConstraintSet(parsed.data);
  if (!v.ok)
    return json(
      { ok: false, errors: v.errors, warnings: v.warnings },
      { status: 422 },
    );
  const meta = (c.meta as any) ?? {};
  const scored = await findSlotsForConstraints({
    set: v.normalized,
    type: appt.type as any,
    ignoreAppointmentId: appointmentId,
    originalDoctorId: meta.doctorId ?? appt.doctorId,
    horizonDays: 14,
    limit: 6,
  });
  const doctors = new Map(
    db
      .select()
      .from(schema.doctors)
      .all()
      .map((d) => [d.id, d.name]),
  );
  return json({
    ok: true,
    warnings: v.warnings,
    slots: scored.map((s) => ({
      doctorId: s.slot.doctorId,
      doctorName: doctors.get(s.slot.doctorId) ?? s.slot.doctorId,
      startUtc: s.slot.startUtc,
      endUtc: s.slot.endUtc,
      day: s.slot.day,
      pts: s.pts,
      chips: s.chips,
    })),
  });
}
