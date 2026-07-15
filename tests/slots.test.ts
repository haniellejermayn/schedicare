import { beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { freshSeed } from "./helpers";
import { findOpenSlots, validatePlacementNow, dayLoad } from "@/core/scheduling";
import { generateSlots, localDayOf, blockOf } from "@/core/slots";
import { getRules } from "@/core/rules";
import { db, schema } from "@/core/db/client";
import { eq } from "drizzle-orm";

const TZ = "Asia/Manila";
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

describe("slot engine", () => {
  beforeEach(() => {
    freshSeed();
  });

  it("only offers times inside the doctor's per-type windows and workdays", async () => {
    const slots = await findOpenSlots({ doctorId: "doc_santos", type: "routine", fromDay: "2026-08-11", toDay: "2026-08-15" });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(hhmm(s.startUtc) >= "13:00").toBe(true); // Santos routine = PM only
      expect(hhmm(s.startUtc) < "17:00").toBe(true);
      const dow = Number(formatInTimeZone(new Date(s.startUtc), TZ, "i"));
      expect(getRules("doc_santos").workDays).toContain(dow);
    }
  });

  it("respects existing appointments plus the trailing buffer", async () => {
    // Reyes has a routine at 08:30 Tue? Seed: appt_bg09 Tue 08:45 routine (30m, buffer 15) → next legal start ≥ 09:30.
    const slots = await findOpenSlots({ doctorId: "doc_reyes", type: "routine", fromDay: "2026-08-11", toDay: "2026-08-11" });
    const times = slots.map((s) => hhmm(s.startUtc));
    expect(times).not.toContain("08:45");
    expect(times).not.toContain("09:00");
    expect(times).not.toContain("09:15"); // inside 08:45+30m+15m buffer
  });

  it("treats external calendar events as busy (Barangay outreach blocks Santos Wed 3-4pm)", async () => {
    const slots = await findOpenSlots({ doctorId: "doc_santos", type: "routine", fromDay: "2026-08-12", toDay: "2026-08-12" });
    for (const s of slots) {
      const t = hhmm(s.startUtc);
      // 30-min routine + 10-min buffer must not overlap 15:00-16:00
      expect(t >= "15:00" && t < "16:00").toBe(false);
      expect(t === "14:40" || t === "14:50").toBe(false); // would spill into the block
    }
  });

  it("excludes a doctor's unavailable dates entirely", async () => {
    db.update(schema.doctors).set({ unavailableDates: ["2026-08-11"] }).where(eq(schema.doctors.id, "doc_santos")).run();
    const slots = await findOpenSlots({ doctorId: "doc_santos", type: "urgent", fromDay: "2026-08-11", toDay: "2026-08-11" });
    expect(slots).toHaveLength(0);
  });

  it("enforces afterTime and dayPart filters", async () => {
    const pm = await findOpenSlots({ doctorId: "doc_reyes", type: "routine", fromDay: "2026-08-11", toDay: "2026-08-12", dayPart: "pm" });
    for (const s of pm) expect(blockOf(s.startUtc)).toBe("pm");
    const late = await findOpenSlots({ doctorId: "doc_santos", type: "routine", fromDay: "2026-08-11", toDay: "2026-08-12", afterTime: "16:00" });
    for (const s of late) expect(hhmm(s.startUtc) >= "16:00").toBe(true);
    expect(late.length).toBeGreaterThan(0);
  });

  it("caps per-day and per-block load against existing bookings", () => {
    const rules = { ...getRules("doc_santos"), maxPerDay: 1, maxPerBlock: { am: 1, pm: 8 } };
    const oneExisting = [{ startUtc: "2026-08-18T01:00:00.000Z", endUtc: "2026-08-18T01:30:00.000Z" }]; // Tue 9:00 MNL
    const base = {
      doctorId: "doc_santos",
      type: "urgent" as const,
      fromDay: "2026-08-18",
      toDay: "2026-08-18",
      busy: [],
      notBefore: new Date("2026-08-10T00:00:00Z"),
    };
    // Day already at maxPerDay → nothing offered.
    expect(generateSlots({ ...base, rules, existing: oneExisting })).toHaveLength(0);
    // AM block full (am cap 1) but day cap open → only PM slots offered.
    const pmOnly = generateSlots({ ...base, rules: { ...rules, maxPerDay: 14 }, existing: oneExisting });
    expect(pmOnly.length).toBeGreaterThan(0);
    expect(pmOnly.every((s) => s.block === "pm")).toBe(true);
  });

  it("validatePlacementNow rejects conflicts and accepts real openings", async () => {
    const taken = await validatePlacementNow({ doctorId: "doc_reyes", type: "routine", startUtc: db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_bg09")).get()!.startUtc });
    expect(taken.ok).toBe(false);
    const open = await findOpenSlots({ doctorId: "doc_reyes", type: "routine", fromDay: "2026-08-11", toDay: "2026-08-12" });
    const ok = await validatePlacementNow({ doctorId: "doc_reyes", type: "routine", startUtc: open[0].startUtc });
    expect(ok.ok).toBe(true);
  });

  it("ignoreAppointmentId lets a patient's own slot be reused during replan", async () => {
    const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_bg09")).get()!;
    const res = await validatePlacementNow({ doctorId: appt.doctorId, type: "routine", startUtc: appt.startUtc, ignoreAppointmentId: appt.id });
    expect(res.ok).toBe(true);
  });

  it("dayLoad reflects active appointments against the daily cap", () => {
    const load = dayLoad("doc_santos", "2026-08-10");
    expect(load).toBeCloseTo(6 / 14, 5); // six cascade appointments, maxPerDay 14
    expect(localDayOf(db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_teresa")).get()!.startUtc)).toBe("2026-08-10");
  });
});
