import { beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { freshSeed } from "./helpers";
import {
  SchedulingConstraintSetSchema,
  describeConstraintDiff,
  describeConstraintSet,
  diffConstraintSets,
  emptyConstraintSet,
  isLegacyRepresentable,
  toLegacyInterpretation,
  triageConstraintSet,
  type SchedulingConstraintSet,
} from "@/core/constraints";
import {
  isoWeekdayOf,
  validateConstraintSet,
} from "@/core/constraintValidation";
import {
  buildSearchWindow,
  findSlotsForConstraints,
  relaxationAnalysis,
  slotSatisfiesHard,
  softPreferencePoints,
} from "@/core/constraintMatching";
import {
  NEGOTIATION_TURN_BUDGET,
  getNegotiation,
  getOrCreateNegotiation,
  guardPolicyAction,
  recordOfferOutcome,
  recordOfferedSlot,
  updateNegotiation,
} from "@/core/negotiations";
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

describe("post-extraction triage", () => {
  const ok = { ok: true };

  it("routes clinical, invalid, and low-confidence sets to a human first", () => {
    const clinical = {
      ...emptyConstraintSet("counter_proposal"),
      confidence: 0.9,
      clinicalContentDetected: true,
    };
    expect(triageConstraintSet(clinical, ok).disposition).toBe("needs_human");
    expect(triageConstraintSet(compoundSet(), { ok: false }).disposition).toBe(
      "needs_human",
    );
    const shaky = { ...compoundSet(), confidence: 0.4 };
    expect(triageConstraintSet(shaky, ok).disposition).toBe("needs_human");
  });

  it("sends compound or unresolved counters to the constraint editor", () => {
    expect(triageConstraintSet(compoundSet(), ok).disposition).toBe(
      "constraint_review",
    );
    const unresolved = {
      ...emptyConstraintSet("counter_proposal"),
      confidence: 0.9,
      unresolvedStatements: ["mga 8:30"],
    };
    expect(triageConstraintSet(unresolved, ok).disposition).toBe(
      "constraint_review",
    );
  });

  it("keeps terminal intents and simple counters on the existing path", () => {
    expect(
      triageConstraintSet(
        { ...emptyConstraintSet("accept"), confidence: 0.95 },
        ok,
      ).disposition,
    ).toBe("route_legacy");
    const simple = emptyConstraintSet("counter_proposal");
    simple.hard.timeWindows = [{ start: "16:00" }];
    simple.confidence = 0.9;
    expect(isLegacyRepresentable(simple)).toBe(true);
    expect(triageConstraintSet(simple, ok).disposition).toBe("route_legacy");
  });

  it("describes a set for the timeline", () => {
    expect(describeConstraintSet(compoundSet())).toMatch(
      /hard.*soft.*confidence 90%/,
    );
  });
});

describe("constraint review lifecycle", () => {
  beforeEach(() => freshSeed());

  const request = (body: unknown) =>
    new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("keeps staff edits pending and marks a successful offer reviewed", async () => {
    const { openCase, getCase } = await import("@/core/cases");
    const { PUT } = await import("@/app/api/cases/[id]/constraints/route");
    const { POST } = await import(
      "@/app/api/cases/[id]/constraints/replan/route"
    );
    const set = compoundSet();
    const c = openCase({
      clinicId: "clinic_riverside",
      type: "doctor_emergency",
      severity: "high",
      title: "constraint review",
      meta: {
        constraintsByAppt: {
          appt_camille: {
            appointmentId: "appt_camille",
            disposition: "constraint_review",
            reviewedAt: null,
            set,
          },
        },
      },
    });

    expect(
      (
        await PUT(request({ set, appointmentId: "appt_camille" }), {
          params: { id: c.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (getCase(c.id).meta as any).constraintsByAppt.appt_camille.reviewedAt,
    ).toBeNull();

    expect(
      (
        await POST(
          request({
            set,
            appointmentId: "appt_camille",
            supersededRecId: "rec_previous",
          }),
          { params: { id: c.id } },
        )
      ).status,
    ).toBe(200);
    expect(
      (getCase(c.id).meta as any).constraintsByAppt.appt_camille.reviewedAt,
    ).toEqual(expect.any(String));
    expect((getCase(c.id).meta as any).latestConstraints).toBeUndefined();
  });

  it("marks successful negotiation delegation reviewed", async () => {
    const { openCase, getCase } = await import("@/core/cases");
    const { POST } = await import(
      "@/app/api/cases/[id]/constraints/negotiate/route"
    );
    const set = compoundSet();
    const c = openCase({
      clinicId: "clinic_riverside",
      type: "doctor_emergency",
      severity: "high",
      title: "constraint negotiation",
      meta: {
        constraintsByAppt: {
          appt_camille: {
            appointmentId: "appt_camille",
            disposition: "constraint_review",
            reviewedAt: null,
            set,
          },
        },
      },
    });

    expect(
      (
        await POST(
          request({
            set,
            appointmentId: "appt_camille",
            supersededRecId: "rec_previous",
          }),
          { params: { id: c.id } },
        )
      ).status,
    ).toBe(200);
    expect(
      (getCase(c.id).meta as any).constraintsByAppt.appt_camille.reviewedAt,
    ).toEqual(expect.any(String));
  });
});

describe("multi-turn constraint diffing", () => {
  it("detects added, removed, and changed fields across scopes", () => {
    const prev = compoundSet(); // Wed/Thu, after 14:00, prefers Santos (excl. fields)
    const next = structuredClone(prev);
    delete next.hard.timeWindows; // "okay na pala kahit anong oras"
    next.hard.allowedDaysOfWeek = [3, 4, 5]; // "Friday works now too"
    next.soft.preferSameDoctor = true; // new preference
    const changes = diffConstraintSets(prev, next);
    const key = (c: any) => `${c.op}:${c.scope}.${c.field}`;
    const keys = changes.map(key);
    expect(keys).toContain("removed:hard.timeWindows");
    expect(keys).toContain("changed:hard.allowedDaysOfWeek");
    expect(keys).toContain("added:soft.preferSameDoctor");
    expect(changes).toHaveLength(3);
    expect(describeConstraintDiff(changes)).toMatch(/removed Time of day/);
    expect(describeConstraintDiff(changes)).toMatch(/\(preference\)/);
  });

  it("reports no changes for identical sets (order-insensitive)", () => {
    const a = compoundSet();
    const b = structuredClone(a);
    b.hard.allowedDaysOfWeek = [4, 3]; // same set, different order
    expect(diffConstraintSets(a, b)).toHaveLength(0);
    expect(describeConstraintDiff([])).toBe("no constraint changes");
  });
});

describe("relaxation analysis (seeded engine)", () => {
  beforeEach(() => {
    freshSeed();
  });

  it("reports zero as stated and per-constraint yields for an impossible set", async () => {
    const set = SchedulingConstraintSetSchema.parse({
      intent: "counter_proposal",
      hard: { allowedDates: ["2026-08-16"], timeWindows: [{ start: "14:00" }] }, // a Sunday — no doctor works Sundays
      confidence: 0.9,
      summary: "Sunday afternoon only",
    });
    const a = await relaxationAnalysis({
      set,
      type: "routine",
      fromDay: "2026-08-11",
      horizonDays: 5,
    });
    expect(a.asStated).toBe(0);
    expect(a.topSlots).toHaveLength(0);
    const byField = Object.fromEntries(
      a.relaxations.map((r) => [r.field, r.slotsIfDropped]),
    );
    expect(byField.allowedDates).toBeGreaterThan(0); // drop Sunday-only → afternoons exist
    expect(byField.timeWindows).toBe(0); // still Sunday-only → still nothing
    expect(a.relaxations[0].field).toBe("allowedDates"); // sorted by yield
    expect(a.relaxations[0].value).toBe("2026-08-16");
  });
});

describe("negotiation state + policy guard", () => {
  beforeEach(() => {
    freshSeed();
  });

  it("creates one row per (case, appointment) and tracks offers", () => {
    const row = getOrCreateNegotiation({
      caseId: "case_x",
      appointmentId: "appt_x",
      patientId: "pat_x",
    });
    expect(
      getOrCreateNegotiation({
        caseId: "case_x",
        appointmentId: "appt_x",
        patientId: "pat_x",
      }).id,
    ).toBe(row.id);
    recordOfferedSlot(row, {
      doctorId: "doc_santos",
      startUtc: "2026-08-12T06:20:00.000Z",
      label: "Wed 2:20 PM",
    });
    recordOfferOutcome(
      getNegotiation("case_x", "appt_x")!,
      "declined",
      "after 4 lang pwede",
    );
    const after = getNegotiation("case_x", "appt_x")!;
    expect((after.offeredSlots as any[])[0].outcome).toBe("declined");
    updateNegotiation(row.id, { turn: 2, lastAction: "offer_slots" });
    expect(getNegotiation("case_x", "appt_x")!.turn).toBe(2);
  });

  it("forces escalation at the turn budget and on invalid references", () => {
    const ctx = {
      turn: 0,
      budget: NEGOTIATION_TURN_BUDGET,
      candidateKeys: ["doc_santos|A"],
      relaxFields: ["timeWindows"],
    };
    const offer = guardPolicyAction(
      {
        action: "offer_slots",
        slotKeys: ["doc_santos|A", "doc_fake|Z"],
        rationale: "r",
      },
      ctx,
    );
    expect(offer.forced).toBeUndefined();
    expect(offer.action.slotKeys).toEqual(["doc_santos|A"]); // unknown key silently dropped

    const ghost = guardPolicyAction(
      { action: "offer_slots", slotKeys: ["doc_fake|Z"], rationale: "r" },
      ctx,
    );
    expect(ghost.forced).toMatch(/no valid candidate/);
    expect(ghost.action.action).toBe("escalate_to_staff");

    const badTarget = guardPolicyAction(
      {
        action: "ask_clarification",
        question: "q?",
        targetField: "requiredDoctorId",
        rationale: "r",
      },
      ctx,
    );
    expect(badTarget.forced).toMatch(/unknown constraint/);

    const repeat = guardPolicyAction(
      {
        action: "ask_clarification",
        question: "q?",
        targetField: "timeWindows",
        rationale: "r",
      },
      { ...ctx, askedFields: ["timeWindows"] },
    );
    expect(repeat.forced).toMatch(/already asked/);
    expect(repeat.action.action).toBe("escalate_to_staff");

    const overBudget = guardPolicyAction(
      { action: "offer_slots", slotKeys: ["doc_santos|A"], rationale: "r" },
      { ...ctx, turn: NEGOTIATION_TURN_BUDGET },
    );
    expect(overBudget.action.action).toBe("escalate_to_staff");
    expect(overBudget.forced).toMatch(/turn budget/);
  });

  it("a full negotiation turn in fallback mode escalates the case with context", async () => {
    const { openCase } = await import("@/core/cases");
    const { negotiationTurn } = await import("@/worker/negotiation");
    const { getCase } = await import("@/core/cases");
    const c = openCase({
      clinicId: "clinic_riverside",
      type: "doctor_emergency",
      severity: "high",
      title: "test negotiation case",
      meta: { doctorId: "doc_santos" },
    });
    const set = { ...compoundSet(), confidence: 0.9 };
    await negotiationTurn({
      caseId: c.id,
      appointmentId: "appt_camille",
      patientId: "pat_camille",
      patientName: "Camille Ocampo",
      supersededRecId: "rec_none",
      set,
    });
    const after = getCase(c.id);
    expect(after.state).toBe("escalated"); // fallback policy → staff, always
    const nego = getNegotiation(c.id, "appt_camille")!;
    expect(nego.status).toBe("escalated");
    expect(nego.lastAction).toBe("escalate_to_staff");
  });

  it("policy fallback escalates (no dumber automation)", async () => {
    const { decideNegotiationMove } =
      await import("@/agents/negotiationPolicy");
    const run = await decideNegotiationMove(
      {
        caseId: null,
        patientName: "Test",
        turn: 0,
        turnBudget: 3,
        set: { hard: {}, soft: {}, summary: "" },
        analysis: { asStated: 0, candidates: [], relaxations: [] },
        offerHistory: [],
      },
      { caseId: null },
    );
    expect(run.mode).toBe("fallback");
    expect(run.output.action).toBe("escalate_to_staff");
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

  it("clinical flag forces needs_human through the bridge", () => {
    const set = emptyConstraintSet("counter_proposal");
    set.clinicalContentDetected = true;
    set.confidence = 0.9;
    const legacy = toLegacyInterpretation(set);
    expect(legacy.intent).toBe("needs_human");
    expect(legacy.summary).toMatch(/clinical/i);
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
