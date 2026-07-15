import { beforeEach, describe, expect, it } from "vitest";
import { freshSeed } from "./helpers";
import { scoreNoShowRisk } from "@/core/risk";
import { rankRecoveryOptions, rankWaitlistCandidates } from "@/core/ranking";
import { demoNow } from "@/core/clock";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";
import { patientHistory } from "@/agents/tools";

describe("no-show risk scorer", () => {
  beforeEach(() => freshSeed());

  it("flags Dennis high: unconfirmed + long lead + 2 no-shows + late cancel", () => {
    const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_dennis")).get()!;
    const r = scoreNoShowRisk({ status: appt.status, startUtc: appt.startUtc, bookedAt: appt.bookedAt, now: demoNow(), history: patientHistory("pat_dennis") });
    expect(r.band).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(60);
    const labels = r.factors.map((f) => f.label.toLowerCase()).join(" | ");
    expect(labels).toMatch(/not yet confirmed|unconfirmed/);
    expect(labels).toContain("no-show");
  });

  it("keeps a confirmed regular like Teresa low", () => {
    const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_teresa")).get()!;
    const r = scoreNoShowRisk({ status: appt.status, startUtc: appt.startUtc, bookedAt: appt.bookedAt, now: demoNow(), history: patientHistory("pat_teresa") });
    expect(r.band).toBe("low");
  });

  it("is monotonic in prior no-shows", () => {
    const base = { status: "booked", startUtc: "2026-08-13T06:00:00.000Z", bookedAt: "2026-07-25T00:00:00.000Z", now: demoNow() };
    const none = scoreNoShowRisk({ ...base, history: [] });
    const two = scoreNoShowRisk({ ...base, history: [{ kind: "no_show" }, { kind: "no_show" }] });
    expect(two.score).toBeGreaterThan(none.score);
  });
});

describe("recovery option ranking", () => {
  beforeEach(() => freshSeed());

  const mk = (startUtc: string, doctorId: string) => ({
    doctorId,
    doctorName: doctorId === "doc_santos" ? "Dr. Elena Santos" : "Dr. Marco Reyes",
    startUtc,
    endUtc: new Date(new Date(startUtc).getTime() + 30 * 60000).toISOString(),
    block: ((new Date(startUtc).getUTCHours() + 8) % 24 < 12 ? "am" : "pm") as "am" | "pm",
    day: startUtc.slice(0, 10),
  });

  it("prefers sooner, preference-matching, same-doctor options and produces Why chips + dots", () => {
    const ctx = {
      originalDoctorId: "doc_santos",
      originalStartUtc: "2026-08-10T05:30:00.000Z", // Mon 1:30pm MNL
      patientPrefDayPart: "pm" as const,
      patientPreferredDoctorId: null,
      staffPriority: 0,
      acceptanceLikelihood: 0.9,
    };
    const soonPmSame = mk("2026-08-11T06:00:00.000Z", "doc_santos"); // Tue 2pm MNL
    const soonAmOther = mk("2026-08-11T00:30:00.000Z", "doc_reyes"); // Tue 8:30am MNL
    const lateFar = mk("2026-08-14T08:00:00.000Z", "doc_reyes"); // Fri 4pm MNL
    const ranked = rankRecoveryOptions(ctx, [lateFar, soonPmSame, soonAmOther]);
    expect(ranked[0].slot.startUtc).toBe(soonPmSame.startUtc);
    expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
    expect(ranked[0].chips.length).toBeGreaterThanOrEqual(3);
    expect(ranked[0].dots).toBeGreaterThanOrEqual(ranked[2].dots);
    for (const r of ranked) {
      expect(r.dots).toBeGreaterThanOrEqual(1);
      expect(r.dots).toBeLessThanOrEqual(5);
    }
  });

  it("staff priority and waiting time raise the score", () => {
    const base = {
      originalDoctorId: "doc_santos",
      originalStartUtc: "2026-08-10T05:30:00.000Z",
      patientPrefDayPart: "any" as const,
      patientPreferredDoctorId: null,
      staffPriority: 0,
    };
    const slot = mk("2026-08-11T06:00:00.000Z", "doc_santos");
    const normal = rankRecoveryOptions(base, [slot])[0];
    const prioritized = rankRecoveryOptions({ ...base, staffPriority: 2, waitingSinceDays: 14 }, [slot])[0];
    expect(prioritized.score).toBeGreaterThan(normal.score);
  });
});

describe("waitlist ranking", () => {
  beforeEach(() => freshSeed());

  it("Rosa wins Liza's vacated Wed 10:00 AM Reyes routine slot; type-mismatched entries are filtered", () => {
    const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_liza")).get()!;
    const slot = { doctorId: appt.doctorId, startUtc: appt.startUtc, endUtc: appt.endUtc, day: "2026-08-12", block: "am" as const };
    const wl = db.select().from(schema.waitlist).where(eq(schema.waitlist.status, "waiting")).all();
    const patients = db.select().from(schema.patients).all();
    const ranked = rankWaitlistCandidates(
      slot,
      "routine",
      demoNow(),
      wl.map((w) => {
        const p = patients.find((x) => x.id === w.patientId)!;
        return {
          waitlistId: w.id,
          patientId: w.patientId,
          patientName: p.name,
          type: w.type,
          dayPart: w.dayPart as any,
          addedAt: w.addedAt,
          staffPriority: w.staffPriority,
          preferredDoctorId: w.doctorId,
          history: patientHistory(w.patientId),
        };
      })
    );
    expect(ranked.some((r) => r.waitlistId === "wl_nica")).toBe(false); // follow_up entry filtered for a routine slot
    expect(ranked[0].waitlistId).toBe("wl_rosa");
    expect(ranked[0].chips.map((c) => c.label).join("|")).toMatch(/Waiting/);
  });
});
