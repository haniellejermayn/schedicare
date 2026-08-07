/**
 * SchedulingConstraintSet — the rich contract between natural-language
 * interpretation and the deterministic scheduling engine.
 *
 * This upgrades the four-field ReplyInterpretation constraint into a compound
 * set: hard constraints (must hold for every offered slot), soft preferences
 * (affect ranking only), unresolved statements (things the model could not map
 * and must never silently drop), and evidence spans (source text for every
 * extracted field, so staff can verify each tag against the patient's words).
 *
 * Conventions match the rest of core/: times are clinic-local "HH:mm", days
 * are clinic-local "yyyy-MM-dd", weekdays are ISO numbers (1 = Monday …
 * 7 = Sunday, same as RuleSetSchema.workDays).
 *
 * The extractor (agents/constraintExtractor.ts) emits this shape; staff edit
 * it in the constraint editor; core/constraintValidation.ts normalizes and
 * gate-checks it; core/constraintMatching.ts turns it into validated slots.
 * The model never touches the engine directly.
 */
import { z } from "zod";
import type { ReplyInterpretation } from "./types";

export const CONSTRAINT_INTENTS = [
  "accept",
  "decline",
  "counter_proposal",
  "cancel",
  "ambiguous",
] as const;
export type ConstraintIntent = (typeof CONSTRAINT_INTENTS)[number];

const HHMM = /^\d{2}:\d{2}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An allowed clinic-local time window. At least one bound must be present:
 * "after 2 PM"  → { start: "14:00" }
 * "before noon" → { end: "12:00" }
 * "2 to 4 PM"   → { start: "14:00", end: "16:00" }
 * Multiple windows are OR'd together.
 */
export const TimeWindowSchema = z
  .object({
    start: z.string().regex(HHMM).optional(),
    end: z.string().regex(HHMM).optional(),
  })
  .refine((w) => w.start != null || w.end != null, {
    message: "time window needs at least a start or an end",
  });
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

const isoWeekday = z.number().int().min(1).max(7);

export const HardConstraintsSchema = z.object({
  /** Only these clinic-local dates are acceptable. */
  allowedDates: z.array(z.string().regex(YMD)).optional(),
  /** These clinic-local dates are unacceptable. */
  excludedDates: z.array(z.string().regex(YMD)).optional(),
  /** Only these ISO weekdays (1=Mon … 7=Sun) are acceptable. */
  allowedDaysOfWeek: z.array(isoWeekday).optional(),
  /** These ISO weekdays are unacceptable. */
  excludedDaysOfWeek: z.array(isoWeekday).optional(),
  /** Allowed clinic-local time windows (OR'd). */
  timeWindows: z.array(TimeWindowSchema).optional(),
  /** No date before this is acceptable ("from the 17th onwards"). */
  earliestDate: z.string().regex(YMD).optional(),
  /** No date after this is acceptable ("this week only"). */
  latestDate: z.string().regex(YMD).optional(),
  /** Patient insists on this doctor. */
  requiredDoctorId: z.string().optional(),
  /**
   * Patient insists on keeping their current doctor without naming them
   * ("ayaw ng bagong doctor"). Resolved against the case's original doctor at
   * match time; enforcement fails closed when the original is unknown.
   */
  requireSameDoctor: z.boolean().optional(),
  /**
   * Reserved for provider-eligibility (Release 1). Pass-through today: the
   * validator carries it, the matcher applies it once specializations exist.
   */
  requiredSpecializationId: z.string().optional(),
});
export type HardConstraints = z.infer<typeof HardConstraintsSchema>;

export const SoftPreferencesSchema = z.object({
  preferredDoctorId: z.string().optional(),
  /** "Keep my doctor if possible" without naming them. */
  preferSameDoctor: z.boolean().optional(),
  preferredDaysOfWeek: z.array(isoWeekday).optional(),
  preferredTimeWindows: z.array(TimeWindowSchema).optional(),
  /** Specific dates the patient would prefer ("tomorrow if possible"). */
  preferredDates: z.array(z.string().regex(YMD)).optional(),
  /** Patient would rather not come before this date (soft "not too soon"). */
  earliestPreferredDate: z.string().regex(YMD).optional(),
  /** Reserved for provider-eligibility (Release 1). */
  preferredSpecializationId: z.string().optional(),
});
export type SoftPreferences = z.infer<typeof SoftPreferencesSchema>;

export const EvidenceSchema = z.object({
  /** Verbatim span from the patient's message. */
  sourceText: z.string().max(300),
  /** Dot-path of the field it supports, e.g. "hard.timeWindows[0]". */
  field: z.string().max(120),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const SchedulingConstraintSetSchema = z.object({
  intent: z.enum(CONSTRAINT_INTENTS),
  hard: HardConstraintsSchema.default({}),
  soft: SoftPreferencesSchema.default({}),
  /**
   * Statements the extractor recognized as constraint-like but could not map
   * confidently. Never silently dropped: they render in the editor and any
   * non-empty list forces staff review.
   */
  unresolvedStatements: z.array(z.string().max(300)).default([]),
  /**
   * Second clinical-detection layer (the deterministic guard is the first).
   * True whenever the message contains ANY medical content — symptoms,
   * conditions, medications, clinical questions. Detection only, never
   * characterization: either layer firing routes the message to a human.
   */
  clinicalContentDetected: z.boolean().default(false),
  /** Source spans backing the extracted fields. */
  evidence: z.array(EvidenceSchema).default([]),
  confidence: z.number().min(0).max(1),
  summary: z.string().max(300),
});
export type SchedulingConstraintSet = z.infer<
  typeof SchedulingConstraintSetSchema
>;

/** Empty set helper (staff-created cases, dictation intake before extraction). */
export function emptyConstraintSet(
  intent: ConstraintIntent = "ambiguous",
): SchedulingConstraintSet {
  return SchedulingConstraintSetSchema.parse({
    intent,
    confidence: 0,
    summary: "",
  });
}

// ---------------------------------------------------------------------------
// Legacy bridge
// ---------------------------------------------------------------------------

const INTENT_TO_LEGACY: Record<
  ConstraintIntent,
  ReplyInterpretation["intent"]
> = {
  accept: "accept_offer",
  decline: "reject_offer",
  counter_proposal: "counter_proposal",
  cancel: "cancel",
  ambiguous: "needs_human",
};

/**
 * Down-convert a rich constraint set into the existing ReplyInterpretation so
 * the current reply flow (worker/replies.ts) keeps working before the
 * negotiation subgraph consumes the rich set natively. Lossy by design: it
 * keeps only what the legacy shape can carry, and anything richer (multiple
 * windows, weekday sets, exclusions, unresolved statements) forces
 * needs_human so nothing is silently narrowed.
 */
export function toLegacyInterpretation(
  set: SchedulingConstraintSet,
): ReplyInterpretation {
  if (set.clinicalContentDetected) {
    return {
      intent: "needs_human",
      confidence: Math.min(set.confidence, 0.5),
      summary:
        "Message contains possible clinical content — staff must read it.",
    };
  }
  const h = set.hard;
  const windows = h.timeWindows ?? [];
  const losesInformation =
    set.unresolvedStatements.length > 0 ||
    windows.length > 1 ||
    (h.allowedDates?.length ?? 0) > 1 ||
    (h.excludedDates?.length ?? 0) > 0 ||
    (h.allowedDaysOfWeek?.length ?? 0) > 0 ||
    (h.excludedDaysOfWeek?.length ?? 0) > 0 ||
    h.earliestDate != null ||
    h.latestDate != null ||
    h.requiredDoctorId != null ||
    h.requireSameDoctor === true;

  if (set.intent === "counter_proposal" && losesInformation) {
    return {
      intent: "needs_human",
      confidence: Math.min(set.confidence, 0.5),
      summary:
        set.summary.slice(0, 200) ||
        "Reply carries constraints richer than the automatic flow supports — staff review.",
    };
  }

  const constraint: NonNullable<ReplyInterpretation["constraint"]> = {};
  const w = windows[0];
  if (w?.start) constraint.afterTime = w.start;
  if (w?.end) constraint.beforeTime = w.end;
  if (!w?.start && w?.end && w.end <= "12:00") constraint.dayPart = "am";
  if (w?.start && w.start >= "12:00") constraint.dayPart = "pm";
  if (h.allowedDates?.length === 1) constraint.preferredDay = h.allowedDates[0];

  return {
    intent: INTENT_TO_LEGACY[set.intent],
    ...(Object.keys(constraint).length > 0 ? { constraint } : {}),
    confidence: set.confidence,
    summary: set.summary.slice(0, 300),
  };
}
