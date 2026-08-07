/**
 * Deterministic normalization + validation of a SchedulingConstraintSet.
 *
 * This runs AFTER Zod schema validation (shape) and BEFORE any slot search
 * (semantics): drop the past, clip to clinic hours, dedupe, and reject
 * impossible combinations. Pure — the caller injects "today" and clinic hours,
 * defaulting to the demo clock and clinic defaults — so it is trivially
 * unit-testable and usable in both live and fallback paths.
 *
 * Errors make the set unusable for search (staff must fix or escalate);
 * warnings describe normalizations that staff should see but that do not
 * block ("dropped a past date", "clipped a window to clinic hours").
 */
import { demoToday } from "./clock";
import {
  SchedulingConstraintSetSchema,
  type SchedulingConstraintSet,
  type TimeWindow,
} from "./constraints";

export interface ConstraintIssue {
  code:
    | "past_date_dropped"
    | "all_dates_past"
    | "date_conflict"
    | "weekday_conflict"
    | "all_weekdays_excluded"
    | "allowed_dates_all_excluded"
    | "window_inverted"
    | "window_outside_hours"
    | "window_clipped"
    | "earliest_past_dropped"
    | "redundant_dropped"
    | "range_in_past"
    | "range_inverted"
    | "schema_invalid";
  message: string;
  field?: string;
}

export interface ConstraintValidationResult {
  ok: boolean;
  errors: ConstraintIssue[];
  warnings: ConstraintIssue[];
  /** Normalized copy — only meaningful when ok. */
  normalized: SchedulingConstraintSet;
}

export interface ValidateOptions {
  /** Clinic-local yyyy-MM-dd; defaults to the demo clock's today. */
  today?: string;
  clinicOpen?: string; // "HH:mm"
  clinicClose?: string; // "HH:mm"
}

const uniqSorted = <T extends string | number>(xs: T[]): T[] =>
  [...new Set(xs)].sort();

/** ISO weekday (1=Mon … 7=Sun) of a clinic-local yyyy-MM-dd, host-TZ independent. */
export function isoWeekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 ? 7 : dow;
}

export function validateConstraintSet(
  input: SchedulingConstraintSet,
  opts: ValidateOptions = {},
): ConstraintValidationResult {
  const today = opts.today ?? demoToday();
  const open = opts.clinicOpen ?? "08:00";
  const close = opts.clinicClose ?? "17:00";
  const errors: ConstraintIssue[] = [];
  const warnings: ConstraintIssue[] = [];

  const parsed = SchedulingConstraintSetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: [
        {
          code: "schema_invalid",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
            .slice(0, 300),
        },
      ],
      warnings: [],
      normalized: input,
    };
  }
  const set: SchedulingConstraintSet = structuredClone(parsed.data);
  const h = set.hard;
  const s = set.soft;

  // -- dates: dedupe, drop the past ----------------------------------------
  if (h.allowedDates) {
    const before = uniqSorted(h.allowedDates);
    const future = before.filter((d) => d >= today);
    if (future.length < before.length)
      warnings.push({
        code: "past_date_dropped",
        message: `Dropped past date(s): ${before.filter((d) => d < today).join(", ")}`,
        field: "hard.allowedDates",
      });
    if (before.length > 0 && future.length === 0)
      errors.push({
        code: "all_dates_past",
        message: "Every allowed date is in the past.",
        field: "hard.allowedDates",
      });
    h.allowedDates = future;
    if (h.allowedDates.length === 0) delete h.allowedDates;
  }
  if (h.excludedDates) {
    h.excludedDates = uniqSorted(h.excludedDates.filter((d) => d >= today));
    if (h.excludedDates.length === 0) delete h.excludedDates;
  }
  if (h.earliestDate && h.earliestDate <= today) {
    // earliestDate of today (or earlier) restricts nothing — canonical form
    // drops it; warn only when it was actually in the past.
    if (h.earliestDate < today)
      warnings.push({
        code: "past_date_dropped",
        message: `Earliest date ${h.earliestDate} is in the past — dropped.`,
        field: "hard.earliestDate",
      });
    delete h.earliestDate;
  }
  if (h.latestDate && h.latestDate < today)
    errors.push({
      code: "range_in_past",
      message: `Latest acceptable date ${h.latestDate} is already in the past.`,
      field: "hard.latestDate",
    });
  if (h.earliestDate && h.latestDate && h.earliestDate > h.latestDate)
    errors.push({
      code: "range_inverted",
      message: `Date range starts (${h.earliestDate}) after it ends (${h.latestDate}).`,
      field: "hard.earliestDate",
    });
  if (h.allowedDates && (h.earliestDate || h.latestDate)) {
    const inRange = h.allowedDates.filter(
      (d) =>
        (!h.earliestDate || d >= h.earliestDate) &&
        (!h.latestDate || d <= h.latestDate),
    );
    if (inRange.length < h.allowedDates.length)
      warnings.push({
        code: "past_date_dropped",
        message: `Dropped allowed date(s) outside the ${h.earliestDate ?? "…"}–${h.latestDate ?? "…"} range.`,
        field: "hard.allowedDates",
      });
    if (h.allowedDates.length > 0 && inRange.length === 0)
      errors.push({
        code: "allowed_dates_all_excluded",
        message: "Every allowed date falls outside the acceptable date range.",
        field: "hard.allowedDates",
      });
    h.allowedDates = inRange;
    if (h.allowedDates.length === 0) delete h.allowedDates;
  }
  if (h.allowedDates && h.excludedDates) {
    const both = h.allowedDates.filter((d) => h.excludedDates!.includes(d));
    if (both.length > 0)
      errors.push({
        code: "date_conflict",
        message: `Date(s) both allowed and excluded: ${both.join(", ")}`,
        field: "hard.allowedDates",
      });
  }

  // -- weekdays -------------------------------------------------------------
  if (h.allowedDaysOfWeek)
    h.allowedDaysOfWeek = uniqSorted(h.allowedDaysOfWeek);
  if (h.excludedDaysOfWeek)
    h.excludedDaysOfWeek = uniqSorted(h.excludedDaysOfWeek);
  if (h.allowedDaysOfWeek && h.excludedDaysOfWeek) {
    const both = h.allowedDaysOfWeek.filter((d) =>
      h.excludedDaysOfWeek!.includes(d),
    );
    if (both.length > 0)
      errors.push({
        code: "weekday_conflict",
        message: `Weekday(s) both allowed and excluded: ${both.join(", ")}`,
        field: "hard.allowedDaysOfWeek",
      });
  }
  if (h.excludedDaysOfWeek && h.excludedDaysOfWeek.length === 7)
    errors.push({
      code: "all_weekdays_excluded",
      message: "Every weekday is excluded — no day can match.",
      field: "hard.excludedDaysOfWeek",
    });
  if (h.allowedDates && h.allowedDates.length > 0) {
    const survives = h.allowedDates.some((d) => {
      const dow = isoWeekdayOf(d);
      if (h.excludedDaysOfWeek?.includes(dow)) return false;
      if (h.allowedDaysOfWeek && !h.allowedDaysOfWeek.includes(dow))
        return false;
      return true;
    });
    if (!survives)
      errors.push({
        code: "allowed_dates_all_excluded",
        message: "Every allowed date falls on an excluded weekday.",
        field: "hard.allowedDates",
      });
  }

  // -- redundant exclusions: an exclusion that could never match anyway ----
  // restricts nothing — canonical form drops it. (Overlaps with allowed sets
  // were already rejected as conflicts above.)
  if (h.excludedDaysOfWeek && h.allowedDaysOfWeek && errors.length === 0) {
    warnings.push({
      code: "redundant_dropped",
      message:
        "Excluded weekday(s) are already outside the allowed weekdays — dropped.",
      field: "hard.excludedDaysOfWeek",
    });
    delete h.excludedDaysOfWeek;
  }
  if (h.excludedDates && errors.length === 0) {
    const otherwisePermitted = (d: string) => {
      if (h.allowedDates && !h.allowedDates.includes(d)) return false;
      if (h.allowedDaysOfWeek && !h.allowedDaysOfWeek.includes(isoWeekdayOf(d)))
        return false;
      if (h.excludedDaysOfWeek?.includes(isoWeekdayOf(d))) return false;
      if (h.earliestDate && d < h.earliestDate) return false;
      if (h.latestDate && d > h.latestDate) return false;
      return true;
    };
    const kept = h.excludedDates.filter(otherwisePermitted);
    if (kept.length < h.excludedDates.length)
      warnings.push({
        code: "redundant_dropped",
        message: "Excluded date(s) that could never match anyway were dropped.",
        field: "hard.excludedDates",
      });
    h.excludedDates = kept;
    if (h.excludedDates.length === 0) delete h.excludedDates;
  }

  // -- time windows: order, clip to clinic hours ---------------------------
  const clipWindows = (
    windows: TimeWindow[],
    field: string,
    hardMode: boolean,
  ): TimeWindow[] => {
    const out: TimeWindow[] = [];
    windows.forEach((w, idx) => {
      const at = `${field}[${idx}]`;
      if (w.start && w.end && w.start >= w.end) {
        (hardMode ? errors : warnings).push({
          code: "window_inverted",
          message: `Window ${w.start}–${w.end} ends before it starts.`,
          field: at,
        });
        return;
      }
      let start = w.start && w.start < open ? open : w.start;
      let end = w.end && w.end > close ? close : w.end;
      const outsideHours =
        (w.start && w.start >= close) || (w.end && w.end <= open);
      if (outsideHours) {
        (hardMode ? errors : warnings).push({
          code: "window_outside_hours",
          message: `Window falls entirely outside clinic hours (${open}–${close}).`,
          field: at,
        });
        return;
      }
      if (start !== w.start || end !== w.end)
        warnings.push({
          code: "window_clipped",
          message: `Window clipped to clinic hours (${open}–${close}).`,
          field: at,
        });
      // Canonical form: bounds equal to clinic open/close restrict nothing —
      // strip them so {start:12:00,end:17:00} ≡ {start:12:00}. A window that
      // loses both bounds spans the whole day and is dropped entirely.
      if (start === open) start = undefined;
      if (end === close) end = undefined;
      if (!start && !end) {
        warnings.push({
          code: "window_clipped",
          message:
            "Window spans the full clinic day — dropped (no restriction).",
          field: at,
        });
        return;
      }
      out.push({ ...(start ? { start } : {}), ...(end ? { end } : {}) });
    });
    return out;
  };
  if (h.timeWindows) {
    h.timeWindows = clipWindows(h.timeWindows, "hard.timeWindows", true);
    if (h.timeWindows.length === 0) delete h.timeWindows;
  }
  if (s.preferredTimeWindows) {
    s.preferredTimeWindows = clipWindows(
      s.preferredTimeWindows,
      "soft.preferredTimeWindows",
      false,
    );
    if (s.preferredTimeWindows.length === 0) delete s.preferredTimeWindows;
  }

  // -- soft dates -----------------------------------------------------------
  if (s.earliestPreferredDate && s.earliestPreferredDate < today) {
    warnings.push({
      code: "earliest_past_dropped",
      message: "Preferred earliest date is in the past and was dropped.",
      field: "soft.earliestPreferredDate",
    });
    delete s.earliestPreferredDate;
  }
  if (s.preferredDaysOfWeek)
    s.preferredDaysOfWeek = uniqSorted(s.preferredDaysOfWeek);
  if (s.preferredDates) {
    s.preferredDates = uniqSorted(s.preferredDates.filter((d) => d >= today));
    if (s.preferredDates.length === 0) delete s.preferredDates;
  }

  return { ok: errors.length === 0, errors, warnings, normalized: set };
}
