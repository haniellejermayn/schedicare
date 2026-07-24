/**
 * Graph-era regression tests.
 *
 * 1. The LangGraph case thread pauses at the approval gate, resumes on the
 *    final staff decision, executes, then pauses again while patients reply —
 *    and the executor auto-schedules simulated replies whenever mail is
 *    EFFECTIVELY simulated (MAIL_PROVIDER=gmail with no Google connected is
 *    the default real-world situation). Replies wake the graph; Miguel's
 *    counter loops it back to the approval gate with a replan.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { and, eq } from "drizzle-orm";
import { freshSeed, pump } from "./helpers";
import { db, schema } from "@/core/db/client";
import { enqueueEvent } from "@/worker/queue";
import { getCase } from "@/core/cases";
import { resetEnvCache } from "@/core/env";
import { caseGraphStatus } from "@/graph/caseGraph";
import { POST as decidePOST } from "@/app/api/recommendations/[id]/decision/route";

const TZ = "Asia/Manila";
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

function jreq(body?: unknown) {
  return new Request("http://test.local/api", { method: "POST", body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}
const decide = (recId: string, body: any) => decidePOST(jreq(body), { params: { id: recId } });
const recsFor = (caseId: string) => db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, caseId)).all();

describe("LangGraph lifecycle + auto-replies (resilience mode)", () => {
  beforeEach(() => {
    freshSeed();
    // Real-world default: no explicit AUTO_SIMULATE_REPLIES, MAIL_PROVIDER at
    // its "gmail" default with no Google connected → effective provider is
    // simulated, so the conversation must flow on its own.
    delete process.env.AUTO_SIMULATE_REPLIES;
    process.env.MAIL_PROVIDER = "gmail";
    resetEnvCache();
  });
  afterEach(() => {
    process.env.AUTO_SIMULATE_REPLIES = "false";
    process.env.MAIL_PROVIDER = "simulated";
    resetEnvCache();
  });

  it("pauses at the gate, wakes on decisions, auto-replies, and loops back for Miguel's replan", async () => {
    const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, "doc_santos")).get()!;
    db.update(schema.doctors)
      .set({ status: "unavailable", unavailableDates: [...(doctor.unavailableDates ?? []), "2026-08-10"] })
      .where(eq(schema.doctors.id, "doc_santos"))
      .run();
    enqueueEvent("doctor_emergency", { doctorId: "doc_santos", date: "2026-08-10", reason: "graph regression" });
    await pump();

    const c = db.select().from(schema.cases).where(eq(schema.cases.type, "doctor_emergency")).all().at(-1)!;
    expect(getCase(c.id).state).toBe("awaiting_approval");

    // The graph thread is literally paused at the approval gate.
    const atGate = await caseGraphStatus(c.id);
    expect(atGate.paused).toBe(true);
    expect(atGate.at).toContain("gate");

    // Staff decide through the real endpoint: reject Grace (her persona never
    // replies — she gets a phone call), approve everyone else. The final
    // decision enqueues resume_case, which the pump delivers to the graph.
    for (const rec of recsFor(c.id)) {
      const name = ((rec.payload as any).patientName ?? "") as string;
      const res = name.startsWith("Grace")
        ? await decide(rec.id, { action: "reject", reason: "Prefers a phone call" })
        : await decide(rec.id, { action: "approve" });
      expect(res.status).toBe(200);
    }
    await pump();

    // Executor ran and — the old bug — must itself enqueue simulate_reply.
    const simEvents = db.select().from(schema.events).where(eq(schema.events.type, "simulate_reply")).all();
    expect(simEvents.length).toBeGreaterThan(0);

    // Graph is now paused in the watch loop, waiting on patients.
    const watching = await caseGraphStatus(c.id);
    expect(watching.paused).toBe(true);
    expect(watching.at).toContain("watch");

    // Time passes: delayed replies process; each one wakes the graph.
    await pump({ includeFuture: true });

    const inbound = db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.caseId, c.id), eq(schema.messages.direction, "inbound")))
      .all();
    expect(inbound.length).toBeGreaterThanOrEqual(4);

    const confirmed = db.select().from(schema.appointments).where(eq(schema.appointments.status, "confirmed")).all();
    expect(confirmed.length).toBeGreaterThanOrEqual(4);

    // Miguel's counter looped the graph back to the approval gate.
    const replan = recsFor(c.id).find((r) => (r.payload as any).replanOf);
    expect(replan).toBeTruthy();
    expect(replan!.status).toBe("proposed");
    for (const o of (replan!.payload as any).options) expect(hhmm(o.startUtc) >= "16:00").toBe(true);
    expect(getCase(c.id).state).toBe("awaiting_approval");
    const backAtGate = await caseGraphStatus(c.id);
    expect(backAtGate.paused).toBe(true);
    expect(backAtGate.at).toContain("gate");

    // Approve the replan → execute → Miguel accepts → graph ends, case done.
    await decide(replan!.id, { action: "approve" });
    await pump({ includeFuture: true });
    expect(getCase(c.id).state).toBe("resolved");
    const ended = await caseGraphStatus(c.id);
    expect(ended.paused).toBe(false);
  }, 90000);
});
