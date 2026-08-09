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
import {
  findSlotsForConstraints,
  relaxationAnalysis,
} from "@/core/constraintMatching";

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
  const doctorId: string | undefined = body?.doctorId;
  const day: string | undefined = body?.day;
  if (doctorId && typeof doctorId !== "string")
    return err("invalid doctorId", 422);
  if (day && (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)))
    return err("invalid day", 422);
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
  if (
    doctorId &&
    !db
      .select({ id: schema.doctors.id })
      .from(schema.doctors)
      .where(eq(schema.doctors.id, doctorId))
      .get()
  )
    return err("doctor not found", 404);
  const scopedSet = day
    ? {
        ...v.normalized,
        hard: {
          ...v.normalized.hard,
          allowedDates:
            !v.normalized.hard.allowedDates ||
            v.normalized.hard.allowedDates.includes(day)
              ? [day]
              : [],
        },
      }
    : v.normalized;
  const scored = await findSlotsForConstraints({
    set: scopedSet,
    type: appt.type as any,
    doctorIds: doctorId ? [doctorId] : undefined,
    ignoreAppointmentId: appointmentId,
    originalDoctorId: meta.doctorId ?? appt.doctorId,
    fromDay: day,
    horizonDays: day ? 0 : 14,
  });
  const visible = scored.slice(0, day ? 60 : 6);
  const doctors = new Map(
    db
      .select()
      .from(schema.doctors)
      .all()
      .map((d) => [d.id, d.name]),
  );
  // Zero-slot intelligence: tell staff which single constraint, if relaxed,
  // would yield options — computed, never guessed.
  let relaxations: Array<{
    field: string;
    label: string;
    value: string;
    slotsIfDropped: number;
  }> = [];
  if (scored.length === 0 && !doctorId && !day) {
    const a = await relaxationAnalysis({
      set: v.normalized,
      type: appt.type as any,
      ignoreAppointmentId: appointmentId,
      originalDoctorId: meta.doctorId ?? appt.doctorId,
      horizonDays: 14,
    });
    relaxations = a.relaxations.filter((r) => r.slotsIfDropped > 0);
  }
  return json({
    ok: true,
    warnings: v.warnings,
    relaxations,
    totalCount: scored.length,
    slots: visible.map((s) => ({
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
