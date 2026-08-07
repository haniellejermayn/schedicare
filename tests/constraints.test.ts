import { beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { freshSeed } from "./helpers";
import {
  SchedulingConstraintSetSchema,
  emptyConstraintSet,
  toLegacyInterpretation,
  type SchedulingConstraintSet,
} from "@/core/constraints";
import {
  isoWeekdayOf,
  validateConstraintSet,
} from "@/core/constraintValidation";
import {
  buildSearchWindow,
  findSlotsForConstraints,
  slotSatisfiesHard,
  softPreferencePoints,
} from "@/core/constraintMatching";
import type { Slot } from "@/core/types";

const TZ = "Asia/Manila";
const TODAY = "2026-08-10"; // vitest DEMO_NOW anchor (a Monday)
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

/** "Wed or Thu after 2 PM, not Aug 14, prefer Dr. Santos" as a constraint set. */
function compoundSet(): SchedulingConstraintSet {
  return SchedulingConstraintSetSchema.parse({
    intent: "counter_proposal",
    hard: {
      allowedDaysOfWeek: [3, 4],
      excludedDates: ["2026-08-14"],
      timeWindows: [{ start: "14:00" }],
    },
    soft: { preferredDoctorId: "doc_santos" },
    evidence: [
      {
        sourceText: "Wednesday or Thursday after 2 PM",
        field: "hard.allowedDaysOfWeek",
      },
      { sourceText: "wag August 14", field: "hard.excludedDates" },
      { sourceText: "prefer Dr. Santos", field: "soft.preferredDoctorId" },
    ],
    confidence: 0.9,
    summary: "Wed/Thu after 2 PM, not Aug 14, prefers Dr. Santos.",
  });
}

const slot = (over: Partial<Slot>): Slot => ({
  doctorId: "doc_santos",
  startUtc: "2026-08-12T06:30:00.000Z", // 14:30 Manila, Wed
  endUtc: "2026-08-12T07:00:00.000Z",
  block: "pm",
  day: "2026-08-12",
  ...over,
});

describe("constraint validation", () => {
  it("normalizes a compound set, dropping redundant exclusions", () => {
    const r = validateConstraintSet(compoundSet(), { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
    // "no Tuesdays" and "not Aug 14 (a Friday)" are already outside the
    // allowed Wed/Thu set — canonical form drops them, with warnings.
    expect(r.warnings.every((w) => w.code === "redundant_dropped")).toBe(true);
    expect(r.normalized.hard.excludedDaysOfWeek).toBeUndefined();
    expect(r.normalized.hard.excludedDates).toBeUndefined();
    expect(r.normalized.hard.allowedDaysOfWeek).toEqual([3, 4]);
  });

  it("drops past dates with a warning, errors when nothing survives", () => {
    const set = compoundSet();
    set.hard.allowedDates = ["2026-08-05", "2026-08-13"];
    const r = validateConstraintSet(set, { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === "past_date_dropped")).toBe(true);
    expect(r.normalized.hard.allowedDates).toEqual(["2026-08-13"]);

    set.hard.allowedDates = ["2026-08-01", "2026-08-05"];
    const dead = validateConstraintSet(set, { today: TODAY });
    expect(dead.ok).toBe(false);
    expect(dead.errors.some((e) => e.code === "all_dates_past")).toBe(true);
  });

  it("rejects impossible combinations", () => {
    const conflict = compoundSet();
    conflict.hard.allowedDates = ["2026-08-13"];
    conflict.hard.excludedDates = ["2026-08-13", "2026-08-14"];
    expect(
      validateConstraintSet(conflict, { today: TODAY }).errors.some(
        (e) => e.code === "date_conflict",
      ),
    ).toBe(true);

    const weekdays = compoundSet();
    weekdays.hard.excludedDaysOfWeek = [1, 2, 3, 4, 5, 6, 7];
    delete weekdays.hard.allowedDaysOfWeek;
    expect(
      validateConstraintSet(weekdays, { today: TODAY }).errors.some(
        (e) => e.code === "all_weekdays_excluded",
      ),
    ).toBe(true);

    const dates = compoundSet();
    dates.hard.allowedDates = ["2026-08-14"]; // a Friday…
    dates.hard.allowedDaysOfWeek = [3, 4]; // …but only Wed/Thu allowed
    delete dates.hard.excludedDates;
    expect(
      validateConstraintSet(dates, { today: TODAY }).errors.some(
        (e) => e.code === "allowed_dates_all_excluded",
      ),
    ).toBe(true);
  });

  it("clips hard windows to clinic hours and rejects fully-outside ones", () => {
    const clipped = compoundSet();
    clipped.hard.timeWindows = [{ start: "06:00", end: "10:00" }];
    const r = validateConstraintSet(clipped, { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === "window_clipped")).toBe(true);
    expect(r.normalized.hard.timeWindows).toEqual([{ end: "10:00" }]); // start==open stripped (canonical)

    const outside = compoundSet();
    outside.hard.timeWindows = [{ start: "18:00", end: "20:00" }];
    expect(
      validateConstraintSet(outside, { today: TODAY }).errors.some(
        (e) => e.code === "window_outside_hours",
      ),
    ).toBe(true);
  });

  it("validates date ranges: clamps past earliest, rejects past latest and inverted ranges", () => {
    const clampable = compoundSet();
    clampable.hard.earliestDate = "2026-08-01";
    const r = validateConstraintSet(clampable, { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.normalized.hard.earliestDate).toBeUndefined(); // ≤ today restricts nothing

    const past = compoundSet();
    past.hard.latestDate = "2026-08-05";
    expect(
      validateConstraintSet(past, { today: TODAY }).errors.some(
        (e) => e.code === "range_in_past",
      ),
    ).toBe(true);

    const inverted = compoundSet();
    inverted.hard.earliestDate = "2026-08-20";
    inverted.hard.latestDate = "2026-08-15";
    expect(
      validateConstraintSet(inverted, { today: TODAY }).errors.some(
        (e) => e.code === "range_inverted",
      ),
    ).toBe(true);

    const outOfRange = compoundSet();
    outOfRange.hard.allowedDates = ["2026-08-12"];
    outOfRange.hard.earliestDate = "2026-08-17";
    delete outOfRange.hard.excludedDates;
    expect(
      validateConstraintSet(outOfRange, { today: TODAY }).errors.some(
        (e) => e.code === "allowed_dates_all_excluded",
      ),
    ).toBe(true);
  });

  it("canonicalizes windows: bounds at clinic open/close are stripped, full-day windows dropped", () => {
    const set = compoundSet();
    set.hard.timeWindows = [
      { start: "12:00", end: "17:00" },
      { start: "08:00", end: "17:00" },
    ];
    const r = validateConstraintSet(set, { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.normalized.hard.timeWindows).toEqual([{ start: "12:00" }]); // ≡ {start:12:00}; full-day dropped
  });

  it("strips exclusions that could never match anyway", () => {
    const set = compoundSet(); // allowed Wed/Thu, excluded Tue via excludedDaysOfWeek? no — build explicit
    set.hard = {
      allowedDaysOfWeek: [1, 2, 3, 4],
      excludedDaysOfWeek: [5],
      earliestDate: "2026-08-24",
      excludedDates: ["2026-08-18", "2026-08-25"], // 18th already < earliest; 25th (Tue) is live
    };
    const r = validateConstraintSet(set, { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.normalized.hard.excludedDaysOfWeek).toBeUndefined(); // Fri already not allowed
    expect(r.normalized.hard.excludedDates).toEqual(["2026-08-25"]); // only the live exclusion survives
    expect(
      r.warnings.filter((w) => w.code === "redundant_dropped").length,
    ).toBe(2);
  });

  it("computes ISO weekdays independent of host timezone", () => {
    expect(isoWeekdayOf("2026-08-10")).toBe(1); // Monday
    expect(isoWeekdayOf("2026-08-16")).toBe(7); // Sunday
  });
});

describe("hard filtering and soft scoring", () => {
  it("enforces every hard constraint", () => {
    const hard = compoundSet().hard;
    expect(slotSatisfiesHard(slot({}), hard)).toBe(true); // Wed 14:30
    expect(slotSatisfiesHard(slot({ day: "2026-08-11" }), hard)).toBe(false); // Tuesday
    expect(slotSatisfiesHard(slot({ day: "2026-08-14" }), hard)).toBe(false); // excluded date
    expect(
      slotSatisfiesHard(slot({ startUtc: "2026-08-12T02:00:00.000Z" }), hard), // 10:00 Manila
    ).toBe(false);
    expect(
      slotSatisfiesHard(slot({}), { ...hard, requiredDoctorId: "doc_reyes" }),
    ).toBe(false);
  });

  it("enforces date ranges and same-doctor (failing closed without an original)", () => {
    expect(slotSatisfiesHard(slot({}), { earliestDate: "2026-08-13" })).toBe(
      false,
    ); // Wed 12 < 13
    expect(slotSatisfiesHard(slot({}), { latestDate: "2026-08-11" })).toBe(
      false,
    );
    expect(
      slotSatisfiesHard(slot({}), {
        earliestDate: "2026-08-12",
        latestDate: "2026-08-12",
      }),
    ).toBe(true);
    const same = { requireSameDoctor: true };
    expect(
      slotSatisfiesHard(slot({}), same, { originalDoctorId: "doc_santos" }),
    ).toBe(true);
    expect(
      slotSatisfiesHard(slot({}), same, { originalDoctorId: "doc_reyes" }),
    ).toBe(false);
    expect(slotSatisfiesHard(slot({}), same)).toBe(false); // unknown original → fail closed
  });

  it("scores soft preferences with explanation chips, never gating", () => {
    const set = compoundSet();
    set.soft.preferSameDoctor = true;
    const santos = softPreferencePoints(slot({}), set.soft, {
      originalDoctorId: "doc_santos",
    });
    expect(santos.pts).toBe(4); // preferred doctor 2 + same doctor 2
    expect(santos.chips.map((c) => c.label)).toContain("Preferred doctor");
    const reyes = softPreferencePoints(
      slot({ doctorId: "doc_reyes" }),
      set.soft,
      { originalDoctorId: "doc_santos" },
    );
    expect(reyes.pts).toBe(0); // still a valid slot — just unranked
  });

  it("pins the search window to allowedDates, else a horizon", () => {
    expect(
      buildSearchWindow({ allowedDates: ["2026-08-13", "2026-08-12"] }),
    ).toEqual({
      fromDay: "2026-08-12",
      toDay: "2026-08-13",
    });
    expect(buildSearchWindow({}, { fromDay: TODAY, horizonDays: 4 })).toEqual({
      fromDay: TODAY,
      toDay: "2026-08-14",
    });
    expect(
      buildSearchWindow(
        { earliestDate: "2026-08-12", latestDate: "2026-08-13" },
        { fromDay: TODAY, horizonDays: 14 },
      ),
    ).toEqual({ fromDay: "2026-08-12", toDay: "2026-08-13" });
  });
});

describe("constraint search against the seeded engine", () => {
  beforeEach(() => {
    freshSeed();
  });

  it("every returned slot satisfies the compound set, sorted by soft points", async () => {
    const results = await findSlotsForConstraints({
      set: compoundSet(),
      type: "routine",
      fromDay: "2026-08-11",
      horizonDays: 4,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const { slot: s } of results) {
      expect([3, 4]).toContain(isoWeekdayOf(s.day));
      expect(s.day).not.toBe("2026-08-14");
      expect(hhmm(s.startUtc) >= "14:00").toBe(true);
    }
    for (let i = 1; i < results.length; i++)
      expect(results[i - 1].pts).toBeGreaterThanOrEqual(results[i].pts);
    expect(results[0].slot.doctorId).toBe("doc_santos"); // preference ranks first
    expect(results.some((r) => r.slot.doctorId !== "doc_santos")).toBe(true); // but does not gate
  });

  it("requiredDoctorId narrows the search to that doctor only", async () => {
    const set = compoundSet();
    set.hard.requiredDoctorId = "doc_reyes";
    const results = await findSlotsForConstraints({
      set,
      type: "routine",
      fromDay: "2026-08-11",
      horizonDays: 4,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const { slot: s } of results) expect(s.doctorId).toBe("doc_reyes");
  });
});

describe("constraint extractor (fallback mode)", () => {
  beforeEach(() => {
    freshSeed();
  });

  it("degrades to a review handoff, never a regex twin", async () => {
    const { extractConstraints } = await import("@/agents/constraintExtractor");
    const run = await extractConstraints(
      {
        caseId: null,
        replyBody: "Wag po sa Friday, after 2 PM na lang kahit anong araw.",
      },
      { caseId: null },
    );
    expect(run.mode).toBe("fallback"); // vitest env pins AI_PROVIDER=fallback
    expect(run.output.intent).toBe("ambiguous");
    expect(run.output.unresolvedStatements.length).toBeGreaterThan(0); // whole message → staff review
    expect(run.output.hard).toEqual({}); // no silently-guessed constraints
    expect(run.output.confidence).toBe(0);
  });
});

describe("legacy bridge", () => {
  it("down-converts a simple counter to the four-field shape", () => {
    const set = emptyConstraintSet("counter_proposal");
    set.hard.timeWindows = [{ start: "16:00" }];
    set.confidence = 0.85;
    set.summary = "Anything after 4 PM.";
    const legacy = toLegacyInterpretation(set);
    expect(legacy.intent).toBe("counter_proposal");
    expect(legacy.constraint?.afterTime).toBe("16:00");
    expect(legacy.constraint?.dayPart).toBe("pm");
  });

  it("routes anything the legacy shape cannot carry to needs_human", () => {
    const legacy = toLegacyInterpretation(compoundSet()); // weekday sets + exclusions
    expect(legacy.intent).toBe("needs_human");
    expect(legacy.confidence).toBeLessThanOrEqual(0.5);
  });

  it("maps terminal intents directly", () => {
    expect(
      toLegacyInterpretation({
        ...emptyConstraintSet("accept"),
        confidence: 0.9,
      }).intent,
    ).toBe("accept_offer");
    expect(
      toLegacyInterpretation({
        ...emptyConstraintSet("cancel"),
        confidence: 0.9,
      }).intent,
    ).toBe("cancel");
    expect(toLegacyInterpretation(emptyConstraintSet("ambiguous")).intent).toBe(
      "needs_human",
    );
  });
});
