/**
 * Deterministic rankers. The Recovery agent packages and justifies what these
 * functions score; it may not silently reorder them (an agent-modified order
 * must carry a stated reason recorded on the recommendation).
 */
import { differenceInCalendarDays, differenceInMinutes } from "date-fns";
import { blockOf } from "./slots";
import type { DayPart, Slot } from "./types";

export interface RecoveryContext {
  /** Visit type — continuity policy is TYPE-CONDITIONAL (see rankRecoveryOptions). */
  type?: "routine" | "follow_up" | "urgent";
  originalDoctorId: string;
  originalStartUtc: string;
  patientPrefDayPart: DayPart;
  patientPreferredDoctorId?: string | null;
  waitingSinceDays?: number; // for waitlist fairness
  /** Fraction of the target doctor's day already booked (0..1), per slot day. */
  dayLoad?: (slot: Slot) => number;
}

export interface ScoredSlot {
  slot: Slot;
  score: number;
  dots: number;
  chips: Array<{ label: string; pts: number }>;
}

/**
 * score = slot soonness + patient preference + continuity/rule fit
 *       + waiting-time fairness - near-capacity penalty.
 * Patient-facing factors dominate; capacity only protects nearly full days.
 */
export function scoreRecoveryOption(
  ctx: RecoveryContext,
  slot: Slot,
  doctorName: string,
): ScoredSlot {
  const chips: Array<{ label: string; pts: number }> = [];
  const origBlock = blockOf(ctx.originalStartUtc);
  const slotBlock = slot.block;

  // w1 — soonness (0..25): full points same-day, decaying over a week.
  const dayDelta = Math.abs(
    differenceInCalendarDays(
      new Date(slot.startUtc),
      new Date(ctx.originalStartUtc),
    ),
  );
  const soonness = Math.max(0, 25 - dayDelta * 5);
  chips.push({
    label:
      dayDelta === 0
        ? "Same day as original"
        : `${dayDelta} day${dayDelta > 1 ? "s" : ""} from original`,
    pts: soonness,
  });

  // w2 — patient day-part preference (0..15).
  let prefPts = 7;
  if (ctx.patientPrefDayPart === "any") prefPts = 10;
  else if (ctx.patientPrefDayPart === slotBlock) prefPts = 15;
  else prefPts = 0;
  chips.push({
    label:
      ctx.patientPrefDayPart === "any"
        ? "Patient has no day-part preference"
        : ctx.patientPrefDayPart === slotBlock
          ? `Matches patient's ${slotBlock.toUpperCase()} preference`
          : `Outside patient's preferred ${ctx.patientPrefDayPart.toUpperCase()}`,
    pts: prefPts,
  });

  // w3 — continuity / rule fit (0..20): same doctor 20; else same day-part 8.
  let fitPts = 0;
  if (slot.doctorId === ctx.originalDoctorId) {
    fitPts = 20;
    chips.push({ label: `Stays with ${doctorName}`, pts: fitPts });
  } else {
    fitPts = slotBlock === origBlock ? 8 : 4;
    chips.push({
      label: `Moves to ${doctorName}${slotBlock === origBlock ? " · same day-part" : ""}`,
      pts: fitPts,
    });
  }
  if (
    ctx.patientPreferredDoctorId &&
    slot.doctorId === ctx.patientPreferredDoctorId &&
    slot.doctorId !== ctx.originalDoctorId
  ) {
    chips.push({ label: "Patient's preferred doctor", pts: 5 });
  }

  // Capacity is neutral below 80%; it is a small resilience penalty near the
  // hard daily cap, never a reward for spreading appointments across doctors.
  const load = Math.min(1, Math.max(0, ctx.dayLoad?.(slot) ?? 0));
  if (load >= 0.9)
    chips.push({ label: "Doctor's day is nearly full", pts: -4 });
  else if (load >= 0.8)
    chips.push({ label: "Doctor's day is getting full", pts: -2 });

  // w5 — waiting-time fairness (0..10).
  if (ctx.waitingSinceDays != null) {
    const fair = Math.min(10, Math.round(ctx.waitingSinceDays / 3));
    if (fair > 0)
      chips.push({ label: `Waiting ${ctx.waitingSinceDays} days`, pts: fair });
  }

  const score = chips.reduce((s, c) => s + c.pts, 0);
  const dots = Math.max(1, Math.min(5, Math.round(score / 20)));
  return { slot, score, dots, chips };
}

export function rankRecoveryOptions(
  ctx: RecoveryContext,
  slots: Array<Slot & { doctorName: string }>,
): ScoredSlot[] {
  const ranked = slots
    .map((s) => scoreRecoveryOption(ctx, s, s.doctorName))
    .sort(
      (a, b) =>
        b.score - a.score || a.slot.startUtc.localeCompare(b.slot.startUtc),
    );
  // Continuity is TYPE-CONDITIONAL, the way clinics actually practice it:
  // a follow-up belongs with the doctor who knows the case — cross-doctor
  // follow-ups surface only when the original doctor has nothing in the
  // window. Routine keeps a mild weighted preference; urgent lets speed win.
  // This is a partition, not a weight: both halves stay score-ordered, and
  // every chip stays honest.
  if (ctx.type === "follow_up") {
    return [
      ...ranked.filter((r) => r.slot.doctorId === ctx.originalDoctorId),
      ...ranked.filter((r) => r.slot.doctorId !== ctx.originalDoctorId),
    ];
  }
  return ranked;
}

// ---------------------------------------------------------------------------
// Waitlist candidate ranking for a vacated slot
// ---------------------------------------------------------------------------

export interface WaitlistCandidateInput {
  waitlistId: string;
  patientId: string;
  patientName: string;
  type: string;
  dayPart: DayPart;
  addedAt: string;
  preferredDoctorId?: string | null;
  history: Array<{ kind: string }>;
}

export function rankWaitlistCandidates(
  slot: Slot,
  slotType: string,
  now: Date,
  candidates: WaitlistCandidateInput[],
) {
  return candidates
    .filter((c) => c.type === slotType)
    .map((c) => {
      const chips: Array<{ label: string; pts: number }> = [];
      const waitDays = Math.max(
        0,
        differenceInCalendarDays(now, new Date(c.addedAt)),
      );
      chips.push({
        label: `Waiting ${waitDays} day${waitDays === 1 ? "" : "s"}`,
        pts: Math.min(30, waitDays * 2),
      });
      if (c.dayPart === "any" || c.dayPart === slot.block)
        chips.push({
          label:
            c.dayPart === "any"
              ? "Flexible on time of day"
              : `Wants ${slot.block.toUpperCase()} — matches`,
          pts: 15,
        });
      else
        chips.push({
          label: `Prefers ${c.dayPart.toUpperCase()} (slot is ${slot.block.toUpperCase()})`,
          pts: 0,
        });
      if (c.preferredDoctorId && c.preferredDoctorId === slot.doctorId)
        chips.push({ label: "Preferred doctor matches", pts: 12 });
      const noShows = c.history.filter((h) => h.kind === "no_show").length;
      if (noShows === 0)
        chips.push({ label: "Reliable attendance history", pts: 8 });
      else
        chips.push({
          label: `${noShows} prior no-show${noShows > 1 ? "s" : ""}`,
          pts: -6 * noShows,
        });
      const score = chips.reduce((s, ch) => s + ch.pts, 0);
      return {
        ...c,
        score,
        dots: Math.max(1, Math.min(5, Math.round(score / 13))),
        chips,
      };
    })
    .sort((a, b) => b.score - a.score || a.addedAt.localeCompare(b.addedAt));
}

/** Minutes between the original time and the offered slot (for UI copy). */
export function minutesFromOriginal(
  originalStartUtc: string,
  slot: Slot,
): number {
  return Math.abs(
    differenceInMinutes(new Date(slot.startUtc), new Date(originalStartUtc)),
  );
}
