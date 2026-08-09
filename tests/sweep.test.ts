import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshSeed, pump } from "./helpers";
import { runDailySweep } from "@/worker/sweep";
import { db, schema } from "@/core/db/client";
import { getCase } from "@/core/cases";
import { seed } from "@/sim/seed";

describe("daily sweep", () => {
  beforeEach(() => freshSeed());

  it("opens the three seeded secondary cases and drafts their outreach; idempotent per day", async () => {
    await runDailySweep();
    await runDailySweep(); // second run is a no-op
    const cases = db.select().from(schema.cases).all();

    const confirmation = cases.filter((c) => c.type === "confirmation");
    expect(confirmation).toHaveLength(1); // Paolo, Tue 09:45, unconfirmed within 36h (same-day bookings excluded)
    expect((confirmation[0].meta as any).appointmentId).toBe("appt_paolo");

    const risk = cases.filter((c) => c.type === "no_show_risk");
    expect(risk).toHaveLength(1); // Dennis
    expect((risk[0].meta as any).appointmentId).toBe("appt_dennis");
    expect((risk[0].meta as any).flag.band).toBe("high");

    const recovery = cases.filter((c) => c.type === "slot_recovery");
    expect(recovery).toHaveLength(1); // Liza's vacated Wednesday slot
    expect((recovery[0].meta as any).appointmentId).toBe("appt_liza");

    await pump();

    const nudge = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, confirmation[0].id)).get()!;
    expect(nudge.kind).toBe("confirm_nudge");
    expect((nudge.payload as any).draft.body.toLowerCase()).toContain("confirm");
    expect(getCase(confirmation[0].id).state).toBe("awaiting_approval");

    const preventive = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, risk[0].id)).get()!;
    expect(preventive.kind).toBe("preventive");
    expect(getCase(risk[0].id).state).toBe("awaiting_approval");

    const fill = db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, recovery[0].id)).get()!;
    expect(fill.kind).toBe("waitlist_fill");
    expect((fill.payload as any).patientName).toBe("Rosa Domingo"); // AM + Reyes preference + longest wait
    expect(getCase(recovery[0].id).state).toBe("awaiting_approval");
  }, 30000);

  it("opens no background cases for the lite presentation seed", async () => {
    seed("lite");
    await runDailySweep();
    expect(db.select().from(schema.cases).all()).toHaveLength(0);
  });
});
