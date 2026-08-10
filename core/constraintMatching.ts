/**
 * Constraint-to-slot matching: turn a validated SchedulingConstraintSet into
 * slots from the deterministic engine.
 *
 * Split like the rest of core/: pure predicates first (slotSatisfiesHard,
 * softPreferencePoints, buildSearchWindow — unit-testable, no DB), then one
 * thin async entry point (findSlotsForConstraints) that calls the ONLY slot
 * source in the system, core/scheduling.findOpenSlots, and post-filters.
 * The engine remains authoritative: a constraint set can only narrow what the
 * engine already validated, never invent a time.
 */
import { addDays, format, parseISO } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db, schema } from "./db/client";
import { demoToday } from "./clock";
import { CLINIC_TZ } from "./env";
import { findOpenSlots } from "./scheduling";
import { isoWeekdayOf } from "./constraintValidation";
import {
  CONSTRAINT_FIELD_LABELS,
  constraintFieldPresent,
  formatConstraintValue,
  type HardConstraints,
  type SchedulingConstraintSet,
  type SoftPreferences,
  type TimeWindow,
} from "./constraints";
import type { ApptType, Slot } from "./types";

export interface ScoredSlot {
  slot: Slot;
  /** Soft-preference points (hard constraints are pass/fail, never scored). */
  pts: number;
  /** Same chip shape as core/ranking so the "Why?" UI reuses one renderer. */
  chips: Array<{ label: string; pts: number }>;
}

const hhmm = (utc: string) =>
  formatInTimeZone(new Date(utc), CLINIC_TZ, "HH:mm");

function inWindow(t: string, w: TimeWindow): boolean {
  if (w.start && t < w.start) return false;
  if (w.end && t >= w.end) return false;
  return true;
}

/**
 * Pure: does this engine-validated slot satisfy every hard constraint?
 * requireSameDoctor fails CLOSED when ctx.originalDoctorId is unknown — an
 * unenforceable hard constraint must never widen the offer set.
 */
export function slotSatisfiesHard(
  slot: Slot,
  hard: HardConstraints,
  ctx: { originalDoctorId?: string } = {},
): boolean {
  if (hard.requiredDoctorId && slot.doctorId !== hard.requiredDoctorId)
    return false;
  if (hard.requireSameDoctor && slot.doctorId !== ctx.originalDoctorId)
    return false;
  if (hard.allowedDates && !hard.allowedDates.includes(slot.day)) return false;
  if (hard.excludedDates?.includes(slot.day)) return false;
  if (hard.earliestDate && slot.day < hard.earliestDate) return false;
  if (hard.latestDate && slot.day > hard.latestDate) return false;
  const dow = isoWeekdayOf(slot.day);
  if (hard.allowedDaysOfWeek && !hard.allowedDaysOfWeek.includes(dow))
    return false;
  if (hard.excludedDaysOfWeek?.includes(dow)) return false;
  if (hard.timeWindows && hard.timeWindows.length > 0) {
    const t = hhmm(slot.startUtc);
    if (!hard.timeWindows.some((w) => inWindow(t, w))) return false;
  }
  return true;
}

/** Pure: soft-preference points + explanation chips for one slot. */
export function softPreferencePoints(
  slot: Slot,
  soft: SoftPreferences,
  ctx: { originalDoctorId?: string } = {},
): { pts: number; chips: Array<{ label: string; pts: number }> } {
  const chips: Array<{ label: string; pts: number }> = [];
  if (soft.preferredDoctorId && slot.doctorId === soft.preferredDoctorId)
    chips.push({ label: "Preferred doctor", pts: 2 });
  if (
    soft.preferSameDoctor &&
    ctx.originalDoctorId &&
    slot.doctorId === ctx.originalDoctorId
  )
    chips.push({ label: "Keeps same doctor", pts: 2 });
  if (soft.preferredDates?.includes(slot.day))
    chips.push({ label: "Preferred date", pts: 2 });
  if (soft.preferredDaysOfWeek?.includes(isoWeekdayOf(slot.day)))
    chips.push({ label: "Preferred day", pts: 1 });
  if (soft.preferredTimeWindows?.some((w) => inWindow(hhmm(slot.startUtc), w)))
    chips.push({ label: "Preferred time", pts: 1 });
  if (soft.earliestPreferredDate && slot.day >= soft.earliestPreferredDate)
    chips.push({ label: "Not too soon", pts: 1 });
  return { pts: chips.reduce((a, c) => a + c.pts, 0), chips };
}

/**
 * Pure: derive the engine search window from the hard constraints.
 * allowedDates pin the window exactly; otherwise search a horizon from today.
 */
export function buildSearchWindow(
  hard: HardConstraints,
  opts: { fromDay?: string; horizonDays?: number } = {},
): { fromDay: string; toDay: string } {
  const fromDay = opts.fromDay ?? demoToday();
  const horizon = opts.horizonDays ?? 14;
  const clamp = (w: { fromDay: string; toDay: string }) => ({
    fromDay:
      hard.earliestDate && hard.earliestDate > w.fromDay
        ? hard.earliestDate
        : w.fromDay,
    toDay:
      hard.latestDate && hard.latestDate < w.toDay ? hard.latestDate : w.toDay,
  });
  if (hard.allowedDates && hard.allowedDates.length > 0) {
    const sorted = [...hard.allowedDates].sort();
    return clamp({
      fromDay: sorted[0] < fromDay ? fromDay : sorted[0],
      toDay: sorted[sorted.length - 1],
    });
  }
  return clamp({
    fromDay,
    toDay: format(addDays(parseISO(fromDay), horizon), "yyyy-MM-dd"),
  });
}

export interface ConstraintSearchInput {
  set: SchedulingConstraintSet;
  type: ApptType;
  /** Doctors to search; defaults to every doctor (requiredDoctorId narrows it). */
  doctorIds?: string[];
  /** The appointment being rescheduled (excluded from conflict checks). */
  ignoreAppointmentId?: string;
  /** Original doctor, for preferSameDoctor scoring. */
  originalDoctorId?: string;
  fromDay?: string;
  horizonDays?: number;
  minimumNoticeMinutes?: number;
  limit?: number;
}

/**
 * The one async entry point: engine search → hard filter → soft scoring.
 * Callers pass a set that already passed validateConstraintSet; this function
 * re-filters regardless (defense in depth), so an unvalidated set can only
 * over-restrict, never over-offer.
 */
export async function findSlotsForConstraints(
  input: ConstraintSearchInput,
): Promise<ScoredSlot[]> {
  const { set } = input;
  const hard = set.hard;
  const window = buildSearchWindow(hard, {
    fromDay: input.fromDay,
    horizonDays: input.horizonDays,
  });
  const pinnedDoctor =
    hard.requiredDoctorId ??
    (hard.requireSameDoctor ? input.originalDoctorId : undefined);
  const doctorIds = pinnedDoctor
    ? input.doctorIds && !input.doctorIds.includes(pinnedDoctor)
      ? []
      : [pinnedDoctor]
    : hard.requireSameDoctor
      ? [] // unenforceable hard constraint (no original known) — fail closed
      : (input.doctorIds ??
        db
          .select({ id: schema.doctors.id })
          .from(schema.doctors)
          .all()
          .map((d) => d.id));

  // Pre-narrow the engine query when a single hard window exists (pure
  // efficiency — correctness is enforced again by slotSatisfiesHard below).
  const single =
    hard.timeWindows?.length === 1 ? hard.timeWindows[0] : undefined;

  const collected: Slot[] = [];
  for (const doctorId of doctorIds) {
    const slots = await findOpenSlots({
      doctorId,
      type: input.type,
      fromDay: window.fromDay,
      toDay: window.toDay,
      afterTime: single?.start,
      beforeTime: single?.end,
      ignoreAppointmentId: input.ignoreAppointmentId,
      minimumNoticeMinutes: input.minimumNoticeMinutes,
    });
    collected.push(...slots);
  }

  const scored = collected
    .filter((slot) =>
      slotSatisfiesHard(slot, hard, {
        originalDoctorId: input.originalDoctorId,
      }),
    )
    .map((slot) => ({
      slot,
      ...softPreferencePoints(slot, set.soft, {
        originalDoctorId: input.originalDoctorId,
      }),
    }))
    .sort(
      (a, b) => b.pts - a.pts || a.slot.startUtc.localeCompare(b.slot.startUtc),
    );

  return input.limit ? scored.slice(0, input.limit) : scored;
}

// ---------------------------------------------------------------------------
// Relaxation analysis — the deterministic fact base for negotiation
// ---------------------------------------------------------------------------

export interface RelaxationOption {
  /** Hard-constraint field that would be dropped. */
  field: string;
  label: string;
  /** Human formatting of the constraint's current value. */
  value: string;
  /** How many valid slots exist WITHOUT this constraint (others intact). */
  slotsIfDropped: number;
}

export interface RelaxationAnalysis {
  /** Valid slots with the set exactly as stated. */
  asStated: number;
  topSlots: ScoredSlot[];
  /** One entry per present hard constraint, sorted by yield (desc). */
  relaxations: RelaxationOption[];
}

/**
 * Pure arithmetic over engine output: run the search as stated, then once per
 * hard constraint with that constraint dropped, and report the counts. This
 * is the ONLY fact base the negotiation policy may cite ("without 'after
 * 14:00' there are 4 options") — the model never estimates availability.
 */
export async function relaxationAnalysis(
  input: ConstraintSearchInput,
): Promise<RelaxationAnalysis> {
  const base = await findSlotsForConstraints({ ...input, limit: undefined });
  const relaxations: RelaxationOption[] = [];
  for (const [field, value] of Object.entries(input.set.hard)) {
    if (!constraintFieldPresent(value)) continue;
    const relaxed = structuredClone(input.set);
    delete (relaxed.hard as Record<string, unknown>)[field];
    const n = (
      await findSlotsForConstraints({
        ...input,
        set: relaxed,
        limit: undefined,
      })
    ).length;
    relaxations.push({
      field,
      label: CONSTRAINT_FIELD_LABELS[field] ?? field,
      value: formatConstraintValue(field, value),
      slotsIfDropped: n,
    });
  }
  relaxations.sort((a, b) => b.slotsIfDropped - a.slotsIfDropped);
  return { asStated: base.length, topSlots: base.slice(0, 6), relaxations };
}
