/**
 * Flagship end-to-end: Dr. Santos emergency → assess → plan → staff decisions
 * (approve 4 / modify Jose / reject Grace) → execute → patient replies →
 * Miguel counter-proposal → single-patient replan → approve → resolved.
 *
 * Runs the real worker router in-process (PACING_MS=0) and drives decisions
 * through the actual API route handlers, so the staff-only approval gate is
 * exercised exactly as the UI does.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { and, eq, inArray } from "drizzle-orm";
import { freshSeed, pump } from "./helpers";
import { db, schema } from "@/core/db/client";
import { enqueueEvent } from "@/worker/queue";
import { handlePatientReply } from "@/worker/replies";
import { getCase } from "@/core/cases";
import { caseScoreboard } from "@/lib/metrics";
import { POST as decidePOST } from "@/app/api/recommendations/[id]/decision/route";
import { POST as unavailablePOST } from "@/app/api/doctor/[id]/unavailable/route";

const TZ = "Asia/Manila";
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

function jreq(body?: unknown) {
  return new Request("http://test.local/api", { method: "POST", body: body ? JSON.stringify(body) : undefined, headers: { "Content-Type": "application/json" } });
}

async function decide(recId: string, body: any) {
  const res = await decidePOST(jreq(body), { params: { id: recId } });
  return { status: res.status, body: await res.json() };
}

function recsFor(caseId: string) {
  return db.select().from(schema.recommendations).where(eq(schema.recommendations.caseId, caseId)).all();
}

function injectReply(caseId: string, recId: string, body: string) {
  const rec = db.select().from(schema.recommendations).where(eq(schema.recommendations.id, recId)).get()!;
  const payload = rec.payload as any;
  const outbound = db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.recommendationId, recId), eq(schema.messages.direction, "outbound")))
    .all()
    .at(-1)!;
  const inbound = db
    .insert(schema.messages)
    .values({
      caseId,
      recommendationId: recId,
      appointmentId: outbound.appointmentId,
      patientId: payload.patientId,
      direction: "inbound",
      subject: `Re: ${outbound.subject}`,
      body,
      status: "received",
      provider: "simulated",
      threadId: outbound.threadId,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get();
  return handlePatientReply(inbound.id);
}

describe("flagship cascade (end-to-end)", () => {
  beforeEach(() => freshSeed());

  it("recovers all six patients with a human decision on every action", async () => {
    // 1) The doctor presses the emergency button (real route handler).
    const res = await unavailablePOST(jreq({ date: "2026-08-10", reason: "Family emergency" }), { params: { id: "doc_santos" } });
    expect(res.status).toBe(200);
    const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, "doc_santos")).get()!;
    expect(doctor.unavailableDates).toContain("2026-08-10");
    expect(doctor.status).toBe("unavailable");

    // 2) Worker drains: assess → schedule → recover → comms → awaiting_approval.
    await pump();
    const c = db.select().from(schema.cases).where(eq(schema.cases.type, "doctor_emergency")).get()!;
    expect(getCase(c.id).state).toBe("awaiting_approval");
    expect(["high", "critical"]).toContain(getCase(c.id).severity);

    const recs = recsFor(c.id);
    expect(recs).toHaveLength(6);
    expect(recs.every((r) => r.kind === "reschedule" && r.status === "proposed")).toBe(true);

    // Camille (urgent) is priority 1; every offered option is a valid future slot NOT with Santos on Monday.
    const byName = (n: string) => recs.find((r) => (r.payload as any).patientName.startsWith(n))!;
    expect((byName("Camille").payload as any).priorityRank).toBe(1);
    for (const r of recs) {
      const p = r.payload as any;
      expect(p.options.length).toBeGreaterThan(0);
      for (const o of p.options) {
        expect(o.day === "2026-08-10" && o.doctorId === "doc_santos").toBe(false);
      }
      expect(p.draft.body).toMatch(/reply yes/i);
    }

    // 3) Agents must NOT be able to execute — the gate holds. (State machine
    //    guard is unit-tested; here we check nothing executed before decisions.)
    expect(recs.every((r) => !r.executedAt)).toBe(true);

    // 4) Staff decisions through the real endpoint.
    const jose = byName("Jose");
    const joseAlt = (jose.payload as any).options.find((o: any) => o.id !== (jose.payload as any).chosenOptionId) ?? (jose.payload as any).options[0];
    for (const name of ["Teresa", "Camille", "Miguel", "Andres"]) {
      const r = await decide(byName(name).id, { action: "approve" });
      expect(r.status).toBe(200);
    }
    // Modify requires a validated option id; junk ids are refused.
    expect((await decide(jose.id, { action: "modify", optionId: "made-up" })).status).toBe(422);
    expect((await decide(jose.id, { action: "modify", optionId: joseAlt.id })).status).toBe(200);
    // Reject requires a reason.
    const grace = byName("Grace");
    expect((await decide(grace.id, { action: "reject" })).status).toBe(400);
    const last = await decide(grace.id, { action: "reject", reason: "Prefers a phone call — front desk will ring her" });
    expect(last.status).toBe(200);
    expect(last.body.transitioned).toBe(true);
    // Double-decide is refused.
    expect((await decide(grace.id, { action: "approve" })).status).toBe(409);

    // 5) Executor runs.
    await pump();
    const afterExec = getCase(c.id);
    expect(afterExec.state).toBe("resolving");

    const recs2 = recsFor(c.id);
    const executed = recs2.filter((r) => r.status === "executed");
    expect(executed).toHaveLength(5);
    // Jose got the modified option.
    const jose2 = recs2.find((r) => r.id === jose.id)!;
    expect((jose2.payload as any).executedOptionId).toBe(joseAlt.id);
    // Originals superseded, replacements booked with calendar events.
    for (const r of executed) {
      const p = r.payload as any;
      const orig = db.select().from(schema.appointments).where(eq(schema.appointments.id, p.appointmentId)).get()!;
      expect(orig.status).toBe("superseded");
      const created = db.select().from(schema.appointments).where(eq(schema.appointments.id, p.createdAppointmentId)).get()!;
      expect(created.status).toBe("booked");
      expect(created.source).toBe("schedicare");
      expect(created.calendarEventId).toBeTruthy();
      const outbound = db.select().from(schema.messages).where(eq(schema.messages.recommendationId, r.id)).all();
      expect(outbound.some((m) => m.direction === "outbound" && m.status === "sent")).toBe(true); // simulated auto-send
    }
    // Grace: original cancelled by clinic + flagged for callback; nothing sent to her.
    const graceAppt = db.select().from(schema.appointments).where(eq(schema.appointments.id, "appt_grace")).get()!;
    expect(graceAppt.status).toBe("cancelled_by_doctor");
    expect(graceAppt.needsCallback).toBe(true);
    expect(db.select().from(schema.messages).where(eq(schema.messages.recommendationId, grace.id)).all()).toHaveLength(0);

    // 6) Replies: four accepts, Miguel counters.
    for (const name of ["Teresa", "Camille", "Andres"]) {
      await injectReply(c.id, byName(name).id, "Yes, that works. Thank you!");
    }
    await injectReply(c.id, jose.id, "Confirmed, see you then. Salamat po.");
    await injectReply(c.id, byName("Miguel").id, "That time doesn't work for me — I'm at work until late. Anything after 4 PM?");
    await pump(); // replan enqueues nothing extra, but keep the queue drained

    // Accepted appointments are confirmed.
    for (const name of ["Teresa", "Camille", "Andres", "Jose"]) {
      const p = recsFor(c.id).find((r) => r.id === byName(name).id)!.payload as any;
      const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, p.createdAppointmentId)).get()!;
      expect(appt.status).toBe("confirmed");
    }

    // 7) Miguel's replan: a fresh recommendation awaiting approval, options after 16:00.
    const c2 = getCase(c.id);
    expect(c2.state).toBe("awaiting_approval");
    const recs3 = recsFor(c.id);
    expect(recs3).toHaveLength(7);
    const miguel1 = recs3.find((r) => r.id === byName("Miguel").id)!;
    expect(miguel1.outcome).toBe("superseded");
    const replan = recs3.find((r) => (r.payload as any).replanOf === miguel1.id)!;
    expect(replan.status).toBe("proposed");
    const rp = replan.payload as any;
    expect(rp.patientName).toMatch(/Miguel/);
    for (const o of rp.options) expect(hhmm(o.startUtc) >= "16:00").toBe(true);

    // 8) Approve the replan, execute, Miguel accepts → resolved.
    expect((await decide(replan.id, { action: "approve" })).body.transitioned).toBe(true);
    await pump();
    await injectReply(c.id, replan.id, "4:30 PM works great. See you then, thanks for accommodating!");
    const final = getCase(c.id);
    expect(final.state).toBe("resolved");

    // Miguel's chain: original → offer1 (superseded) → offer2 (confirmed).
    const finalReplan = recsFor(c.id).find((r) => r.id === replan.id)!.payload as any;
    const miguelFinal = db.select().from(schema.appointments).where(eq(schema.appointments.id, finalReplan.createdAppointmentId)).get()!;
    expect(miguelFinal.status).toBe("confirmed");
    expect(hhmm(miguelFinal.startUtc) >= "16:00").toBe(true);
    const offer1Appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, (miguel1.payload as any).createdAppointmentId)).get()!;
    expect(offer1Appt.status).toBe("superseded");

    // 9) Scoreboard tells the recovery story.
    const s = caseScoreboard(c.id);
    expect(s.rebooked).toBe(5); // Teresa, Camille, Andres, Jose + Miguel's replan (his superseded first offer doesn't double-count)
    expect(s.confirmed).toBe(5);
    expect(s.declinedOrCallback).toBeGreaterThanOrEqual(1); // Grace
    expect(s.minutesRecovered).toBeGreaterThanOrEqual(120);

    // 10) Audit trail: staff decisions + executor effects are all present.
    const audit = db.select().from(schema.auditLog).all();
    expect(audit.filter((a) => a.action === "recommendation.approve").length).toBeGreaterThanOrEqual(5);
    expect(audit.some((a) => a.action === "recommendation.reject")).toBe(true);
    expect(audit.some((a) => a.action === "recommendation.modify")).toBe(true);
    expect(audit.some((a) => a.action === "appointment.rescheduled")).toBe(true);
    expect(audit.some((a) => a.actor === "doctor" && a.action === "doctor.marked_unavailable")).toBe(true);
  }, 60000);

  it("cancellation → waitlist backfill: Rosa is offered Liza-style vacated slots", async () => {
    // Cancel Maria's Wednesday follow-up through the normal patient path.
    const { PATCH } = await import("@/app/api/appointments/[id]/route");
    const res = await PATCH(jreq({ action: "cancel" }), { params: { id: "appt_maria" } });
    expect(res.status).toBe(200);
    await pump();
    const c = db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.type, "patient_cancellation"))
      .all()
      .at(-1)!;
    expect(getCase(c.id).state).toBe("awaiting_approval");
    const rec = recsFor(c.id).find((r) => r.kind === "waitlist_fill")!;
    const p = rec.payload as any;
    expect(p.patientName).toBe("Nica Alonzo"); // only follow_up waitlist entry
    // Approve → executes → offer sent → accept → scheduled.
    await decide(rec.id, { action: "approve" });
    await pump();
    await injectReply(c.id, rec.id, "Yes! I'll take the earlier slot, thank you so much!");
    const wl = db.select().from(schema.waitlist).where(eq(schema.waitlist.id, "wl_nica")).get()!;
    expect(wl.status).toBe("scheduled");
    expect(getCase(c.id).state).toBe("resolved");
  }, 30000);
});
