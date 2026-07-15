/**
 * Regression test for the "case stuck in resolving" bug.
 *
 * The executor's scheduleSimReply() must fire whenever mail is EFFECTIVELY
 * simulated (Presentation Resilience Mode) — including the common case where
 * MAIL_PROVIDER defaults to "gmail" but Google was never connected, so the
 * runtime degraded to the simulated provider. Previously the gate keyed off the
 * raw MAIL_PROVIDER env var, so no simulate_reply events were ever enqueued and
 * the case never advanced past `resolving`.
 *
 * Unlike tests/cascade.test.ts (which sets AUTO_SIMULATE_REPLIES=false and
 * injects replies by hand), this test drives the REAL worker auto-reply path:
 * execute → scheduleSimReply → simulate_reply event → injectSimulatedReply →
 * handlePatientReply, exactly as `npm run worker` does.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { and, eq } from "drizzle-orm";
import { freshSeed, pump } from "./helpers";
import { db, schema } from "@/core/db/client";
import { enqueueEvent } from "@/worker/queue";
import { getCase } from "@/core/cases";
import { resetEnvCache } from "@/core/env";
import { POST as decidePOST } from "@/app/api/recommendations/[id]/decision/route";

const TZ = "Asia/Manila";
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

function jreq(body?: unknown) {
  return new Request("http://test.local/api", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}
const decide = (recId: string, body: any) =>
  decidePOST(jreq(body), { params: { id: recId } });
const recsFor = (caseId: string) =>
  db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, caseId))
    .all();

describe("executor auto-schedules simulated replies (resilience mode)", () => {
  beforeEach(() => {
    freshSeed();
    // Simulate the real runtime: no explicit AUTO_SIMULATE_REPLIES, and
    // MAIL_PROVIDER left at its default ("gmail") with no Google connected, so
    // the effective provider is simulated. This is the exact prod situation.
    delete process.env.AUTO_SIMULATE_REPLIES;
    process.env.MAIL_PROVIDER = "gmail";
    resetEnvCache();
  });
  afterEach(() => {
    // Restore the suite-wide default so manual-injection tests are unaffected.
    process.env.AUTO_SIMULATE_REPLIES = "false";
    process.env.MAIL_PROVIDER = "simulated";
    resetEnvCache();
  });

  it("flows from execution through auto-replies to a Miguel replan without staff injecting anything", async () => {
    const doctor = db
      .select()
      .from(schema.doctors)
      .where(eq(schema.doctors.id, "doc_santos"))
      .get()!;
    db.update(schema.doctors)
      .set({
        status: "unavailable",
        unavailableDates: [...(doctor.unavailableDates ?? []), "2026-08-10"],
      })
      .where(eq(schema.doctors.id, "doc_santos"))
      .run();
    enqueueEvent("doctor_emergency", {
      doctorId: "doc_santos",
      date: "2026-08-10",
      reason: "regression",
    });
    await pump();

    const c = db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.type, "doctor_emergency"))
      .all()
      .at(-1)!;
    expect(getCase(c.id).state).toBe("awaiting_approval");

    // Staff approve every recommendation through the real decision endpoint.
    for (const rec of recsFor(c.id)) {
      const res = await decide(rec.id, { action: "approve" });
      expect(res.status).toBe(200);
    }

    // Executor runs AND must enqueue delayed simulate_reply events itself.
    await pump();
    const simEvents = db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "simulate_reply"))
      .all();
    expect(simEvents.length).toBeGreaterThan(0); // the bug: this was 0

    // Time passes → replies get processed by the worker (not by the test).
    await pump({ includeFuture: true });

    // Inbound simulated messages now exist — created by the worker path.
    const inbound = db
      .select()
      .from(schema.messages)
      .where(
        and(
          eq(schema.messages.caseId, c.id),
          eq(schema.messages.direction, "inbound"),
        ),
      )
      .all();
    expect(inbound.length).toBeGreaterThanOrEqual(4);
    expect(inbound.every((m) => m.provider === "simulated")).toBe(true);

    // At least four patients auto-confirmed their new appointments.
    const confirmed = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.status, "confirmed"))
      .all();
    expect(confirmed.length).toBeGreaterThanOrEqual(4);

    // Miguel's counter-proposal produced a single-patient replan, awaiting
    // approval — the case did NOT get stuck in `resolving`.
    const replan = recsFor(c.id).find((r) => (r.payload as any).replanOf);
    expect(replan).toBeTruthy();
    expect(replan!.status).toBe("proposed");
    for (const o of (replan!.payload as any).options)
      expect(hhmm(o.startUtc) >= "16:00").toBe(true);
    expect(getCase(c.id).state).toBe("awaiting_approval");

    // The approval gate still holds: nothing auto-approved the replan.
    expect(
      db
        .select()
        .from(schema.auditLog)
        .all()
        .some((a) => a.action === "recommendation.approve"),
    ).toBe(true);
  }, 60000);
});
