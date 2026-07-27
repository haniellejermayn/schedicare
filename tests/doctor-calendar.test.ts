import { beforeEach, describe, expect, it } from "vitest";
import { freshSeed } from "./helpers";

/**
 * Verifies the /api/doctor/[id] externalBusy addition end to end, entirely
 * in resilience mode (CALENDAR_PROVIDER=simulated per vitest.config.ts) —
 * no Google account needed. Confirms:
 *   1. The route returns externalBusy at all.
 *   2. Genuine external blocks (the seeded "Barangay health outreach", not
 *      one of Santos's own tracked appointments) survive.
 *   3. Santos's own appointment mirrors are correctly deduped OUT, so a
 *      SchediCare-booked visit never double-renders as also "busy".
 */
describe("GET /api/doctor/[id] — externalBusy", () => {
  beforeEach(() => freshSeed());

  it("returns only genuine external calendar blocks, deduped against known appointments", async () => {
    const { GET } = await import("@/app/api/doctor/[id]/route");
    const res = await GET(new Request("http://test.local/api"), { params: { id: "doc_santos" } });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.externalBusy)).toBe(true);
    // Only the true external block should remain — every one of Santos's own
    // appointment mirrors (Teresa, Jose, Grace, Camille, Miguel, Andres, plus
    // background load) must be filtered out by the knownIntervals dedupe.
    expect(body.externalBusy).toHaveLength(1);
    expect(body.externalBusy[0]).toMatchObject({
      startUtc: "2026-08-12T07:00:00.000Z", // Wed 15:00 Manila — "Barangay health outreach"
      endUtc: "2026-08-12T08:00:00.000Z",
    });

    // Sanity: the appointments array itself is unaffected by this addition.
    expect(body.appointments.some((a: any) => a.id === "appt_teresa")).toBe(true);
  });

  it("returns an empty externalBusy array for a doctor with no calendarId", async () => {
    const { db, schema } = await import("@/core/db/client");
    const { eq } = await import("drizzle-orm");
    db.update(schema.doctors).set({ calendarId: null }).where(eq(schema.doctors.id, "doc_reyes")).run();

    const { GET } = await import("@/app/api/doctor/[id]/route");
    const res = await GET(new Request("http://test.local/api"), { params: { id: "doc_reyes" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.externalBusy).toEqual([]);
  });
});
