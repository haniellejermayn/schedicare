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
/**
 * Can the legacy four-field ReplyInterpretation carry this set without losing
 * information? Anything richer must go through the constraint editor instead
 * of being silently narrowed.
 */
export function isLegacyRepresentable(set: SchedulingConstraintSet): boolean {
  const h = set.hard;
  const hasSoftConstraint = Object.values(set.soft).some(
    (value) =>
      value != null &&
      value !== false &&
      (!Array.isArray(value) || value.length > 0),
  );
  return !(
    set.unresolvedStatements.length > 0 ||
    hasSoftConstraint ||
    (h.timeWindows?.length ?? 0) > 1 ||
    (h.allowedDates?.length ?? 0) > 1 ||
    (h.excludedDates?.length ?? 0) > 0 ||
    (h.allowedDaysOfWeek?.length ?? 0) > 0 ||
    (h.excludedDaysOfWeek?.length ?? 0) > 0 ||
    h.earliestDate != null ||
    h.latestDate != null ||
    h.requiredDoctorId != null ||
    h.requireSameDoctor === true
  );
}

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

  if (set.intent === "counter_proposal" && !isLegacyRepresentable(set)) {
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

// ---------------------------------------------------------------------------
// Triage: what should the reply pipeline do with an extraction?
// ---------------------------------------------------------------------------

export type ConstraintDisposition =
  | { disposition: "route_legacy"; reason: string }
  | { disposition: "constraint_review"; reason: string }
  | { disposition: "needs_human"; reason: string };

/**
 * Deterministic post-extraction triage. The model proposes; this decides the
 * lane:
 *  - needs_human: clinical content, invalid set, or low confidence — a person
 *    reads the message itself first.
 *  - constraint_review: a clean but compound counter-proposal (or one with
 *    unresolved statements) — staff approve/edit the set in the constraint
 *    editor, then search. The AI never auto-acts on compound sets.
 *  - route_legacy: terminal intents and simple counters — flows through the
 *    existing (approval-gated) reply routing unchanged.
 */
export function triageConstraintSet(
  set: SchedulingConstraintSet,
  validation: { ok: boolean },
): ConstraintDisposition {
  if (set.clinicalContentDetected)
    return { disposition: "needs_human", reason: "possible clinical content" };
  if (!validation.ok)
    return {
      disposition: "needs_human",
      reason: "extracted constraints failed validation",
    };
  if (set.confidence < 0.6)
    return { disposition: "needs_human", reason: "low extraction confidence" };
  if (set.intent !== "counter_proposal")
    return {
      disposition: "route_legacy",
      reason: `terminal intent: ${set.intent}`,
    };
  if (set.unresolvedStatements.length > 0)
    return {
      disposition: "constraint_review",
      reason: "unresolved statements need staff input",
    };
  if (!isLegacyRepresentable(set))
    return {
      disposition: "constraint_review",
      reason: "compound constraints — staff review and search",
    };
  return {
    disposition: "route_legacy",
    reason: "simple counter — automatic replan",
  };
}

/** One-line human summary for timelines and audit entries. */
export function describeConstraintSet(set: SchedulingConstraintSet): string {
  const hard = Object.values(set.hard).filter(
    (v) => v != null && (!Array.isArray(v) || v.length > 0),
  ).length;
  const soft = Object.values(set.soft).filter(
    (v) => v != null && (!Array.isArray(v) || v.length > 0),
  ).length;
  const bits = [`${hard} hard`, `${soft} soft`];
  if (set.unresolvedStatements.length > 0)
    bits.push(`${set.unresolvedStatements.length} unresolved`);
  if (set.clinicalContentDetected) bits.push("clinical flag");
  return `${bits.join(", ")} · confidence ${Math.round(set.confidence * 100)}%`;
}

// ---------------------------------------------------------------------------
// Multi-turn support: field labels + deterministic diffing
// ---------------------------------------------------------------------------

/** Human labels shared by the editor UI and timeline narration. */
export const CONSTRAINT_FIELD_LABELS: Record<string, string> = {
  allowedDates: "Only these dates",
  excludedDates: "Not these dates",
  allowedDaysOfWeek: "Only these days",
  excludedDaysOfWeek: "Not these days",
  timeWindows: "Time of day",
  earliestDate: "Not before",
  latestDate: "Not after",
  requiredDoctorId: "Doctor (required)",
  requireSameDoctor: "Same doctor (required)",
  preferredDoctorId: "Preferred doctor",
  preferSameDoctor: "Prefers same doctor",
  preferredDates: "Preferred dates",
  preferredDaysOfWeek: "Preferred days",
  preferredTimeWindows: "Preferred time of day",
  earliestPreferredDate: "Prefers not too soon",
};

export interface ConstraintFieldChange {
  scope: "hard" | "soft";
  field: string;
  op: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

/** Is a constraint field meaningfully present? Shared by diffing/analysis. */
export const constraintFieldPresent = (v: unknown): boolean =>
  v != null && (!Array.isArray(v) || v.length > 0) && v !== false;
const hasValue = constraintFieldPresent;

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).sort().join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${k}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Deterministic diff between two constraint sets (the audit trail for
 * multi-turn merging). We log the diff WE compute — never a diff the model
 * reports about itself.
 */
export function diffConstraintSets(
  prev: SchedulingConstraintSet,
  next: SchedulingConstraintSet,
): ConstraintFieldChange[] {
  const changes: ConstraintFieldChange[] = [];
  for (const scope of ["hard", "soft"] as const) {
    const a = prev[scope] as Record<string, unknown>;
    const b = next[scope] as Record<string, unknown>;
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const before = a[field];
      const after = b[field];
      if (hasValue(before) && !hasValue(after))
        changes.push({ scope, field, op: "removed", before });
      else if (!hasValue(before) && hasValue(after))
        changes.push({ scope, field, op: "added", after });
      else if (
        hasValue(before) &&
        hasValue(after) &&
        canonical(before) !== canonical(after)
      )
        changes.push({ scope, field, op: "changed", before, after });
    }
  }
  return changes;
}

/** One-line narration for timelines: "removed Time of day; added Not these days". */
export function describeConstraintDiff(
  changes: ConstraintFieldChange[],
): string {
  if (changes.length === 0) return "no constraint changes";
  return changes
    .map(
      (c) =>
        `${c.op} ${CONSTRAINT_FIELD_LABELS[c.field] ?? c.field}${c.scope === "soft" ? " (preference)" : ""}`,
    )
    .join("; ");
}

const DOW_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Human formatting for a constraint field's value (timeline, hints, prompts). */
export function formatConstraintValue(field: string, v: unknown): string {
  if (field.includes("DaysOfWeek"))
    return (v as number[]).map((d) => DOW_NAMES[d]).join(", ");
  if (field.includes("Window"))
    return (v as Array<{ start?: string; end?: string }>)
      .map((w) =>
        w.start && w.end
          ? `${w.start}–${w.end}`
          : w.start
            ? `after ${w.start}`
            : `before ${w.end}`,
      )
      .join(" or ");
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return "yes";
  return String(v);
}
