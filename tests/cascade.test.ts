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
import { fmtWhen } from "@/core/clock";
import { longWhen } from "@/agents/comms";
import { getCase } from "@/core/cases";
import {
  maybeResolveCase,
  openCase,
  transitionCase,
} from "@/core/cases";
import { commsStep } from "@/worker/steps";
import {
  getNegotiation,
  getOrCreateNegotiation,
  recordOfferedSlot,
} from "@/core/negotiations";
import { caseScoreboard } from "@/lib/metrics";
import { POST as decidePOST } from "@/app/api/recommendations/[id]/decision/route";
import { POST as unavailablePOST } from "@/app/api/doctor/[id]/unavailable/route";

const TZ = "Asia/Manila";
const hhmm = (iso: string) => formatInTimeZone(new Date(iso), TZ, "HH:mm");

function jreq(body?: unknown) {
  return new Request("http://test.local/api", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
  });
}

async function decide(recId: string, body: any) {
  const res = await decidePOST(jreq(body), { params: { id: recId } });
  return { status: res.status, body: await res.json() };
}

function recsFor(caseId: string) {
  return db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.caseId, caseId))
    .all();
}

function injectReply(caseId: string, recId: string, body: string) {
  const rec = db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.id, recId))
    .get()!;
  const payload = rec.payload as any;
  const outbound = db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.recommendationId, recId),
        eq(schema.messages.direction, "outbound"),
      ),
    )
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
    const res = await unavailablePOST(
      jreq({ date: "2026-08-10", reason: "Family emergency" }),
      { params: { id: "doc_santos" } },
    );
    expect(res.status).toBe(200);
    const doctor = db
      .select()
      .from(schema.doctors)
      .where(eq(schema.doctors.id, "doc_santos"))
      .get()!;
    expect(doctor.unavailableDates).toContain("2026-08-10");
    expect(doctor.status).toBe("unavailable");

    // 2) Worker drains: assess → schedule → recover → comms → awaiting_approval.
    await pump();
    const c = db
      .select()
      .from(schema.cases)
      .where(eq(schema.cases.type, "doctor_emergency"))
      .get()!;
    expect(getCase(c.id).state).toBe("awaiting_approval");
    expect(["high", "critical"]).toContain(getCase(c.id).severity);

    const recs = recsFor(c.id);
    expect(recs).toHaveLength(6);
    expect(
      recs.every((r) => r.kind === "reschedule" && r.status === "proposed"),
    ).toBe(true);

    // Camille (urgent) is priority 1; every offered option is a valid future slot NOT with Santos on Monday.
    const byName = (n: string) =>
      recs.find((r) => (r.payload as any).patientName.startsWith(n))!;
    expect((byName("Camille").payload as any).priorityRank).toBe(1);
    for (const r of recs) {
      const p = r.payload as any;
      expect(p.options.length).toBeGreaterThan(0);
      for (const o of p.options) {
        expect(o.day === "2026-08-10" && o.doctorId === "doc_santos").toBe(
          false,
        );
      }
      // Conversational confirm (deliberate copy decision): invite a natural
      // reply — never demand an all-caps YES.
      expect(p.draft.body).toMatch(/just reply to let us know/i);
      expect(p.draft.body).not.toMatch(/reply yes/i);
      // Standardized subject shape: "[Clinic] Aug 10 Appointment - <Kind>".
      expect(p.draft.subject).toMatch(
        /^\[Riverside Family Clinic\] [A-Z][a-z]{2} \d{1,2} Appointment - /,
      );
    }

    // 3) Agents must NOT be able to execute — the gate holds. (State machine
    //    guard is unit-tested; here we check nothing executed before decisions.)
    expect(recs.every((r) => !r.executedAt)).toBe(true);

    // 4) Staff decisions through the real endpoint.
    const jose = byName("Jose");
    const joseAlt =
      (jose.payload as any).options.find(
        (o: any) => o.id !== (jose.payload as any).chosenOptionId,
      ) ?? (jose.payload as any).options[0];
    // Sibling-conflict guard: staff can't offer one slot to two patients.
    // Find any (rec, ranked option) whose option overlaps a SIBLING's chosen
    // offer — modifying to it must be refused at decision time with the
    // sibling's name, not left to fail at execution after the hold lands.
    {
      // The ranked lists can't produce this (cross-patient dedupe), so use
      // the manual staff picker: two SAME-TYPE patients — the sibling's
      // chosen slot is, to the engine, still an open slot for the other
      // (no hold exists yet). The guard must refuse it by name.
      const all = recsFor(c.id).filter((r) => r.kind === "reschedule");
      const pair = all.flatMap((r) =>
        all
          .filter(
            (s) =>
              s.id !== r.id &&
              (s.payload as any).type === (r.payload as any).type,
          )
          .map((s) => ({ r, s })),
      )[0];
      expect(pair).toBeDefined(); // the full seed has same-type patients
      const sp = pair.s.payload as any;
      const so = (sp.options ?? []).find(
        (x: any) => x.id === sp.chosenOptionId,
      );
      const conflict = await decide(pair.r.id, {
        action: "modify",
        slot: { doctorId: so.doctorId, startUtc: so.startUtc },
      });
      expect(conflict.status).toBe(422);
      expect(conflict.body.error).toContain(
        `already being offered to ${sp.patientName}`,
      );
    }
    for (const name of ["Teresa", "Camille", "Miguel", "Andres"]) {
      const r = await decide(byName(name).id, { action: "approve" });
      expect(r.status).toBe(200);
    }
    // Modify requires a validated option id; junk ids are refused.
    expect(
      (await decide(jose.id, { action: "modify", optionId: "made-up" })).status,
    ).toBe(422);
    expect(
      (await decide(jose.id, { action: "modify", optionId: joseAlt.id }))
        .status,
    ).toBe(200);
    // A time change is a REVISION, not a decision: Jose returns to the gate
    // pointed at the staff-picked slot, with the message re-templated for it,
    // and must be approved again — what staff approve is what gets sent.
    const joseAfter = recsFor(c.id).find((r) => r.id === jose.id)!;
    expect(joseAfter.status).toBe("proposed");
    expect((joseAfter.payload as any).chosenOptionId).toBe(joseAlt.id);
    expect((joseAfter.payload as any).draft.body).toContain(
      longWhen(fmtWhen(joseAlt.startUtc)),
    );
    expect(
      (joseAfter.payload as any).options.find((o: any) => o.id === joseAlt.id)
        .chips,
    ).toEqual([{ label: "Staff picked" }]);
    expect((await decide(jose.id, { action: "approve" })).status).toBe(200);
    // Reject requires a reason.
    const grace = byName("Grace");
    expect((await decide(grace.id, { action: "reject" })).status).toBe(400);
    const last = await decide(grace.id, {
      action: "reject",
      reason: "Prefers a phone call — front desk will ring her",
    });
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
      const orig = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, p.appointmentId))
        .get()!;
      expect(orig.status).toBe("superseded");
      const created = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, p.createdAppointmentId))
        .get()!;
      expect(created.status).toBe("booked");
      expect(created.source).toBe("schedicare");
      expect(created.calendarEventId).toBeTruthy();
      const outbound = db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.recommendationId, r.id))
        .all();
      expect(
        outbound.some((m) => m.direction === "outbound" && m.status === "sent"),
      ).toBe(true); // simulated auto-send
    }
    // Grace: original cancelled by clinic + flagged for callback; nothing sent to her.
    const graceAppt = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, "appt_grace"))
      .get()!;
    expect(graceAppt.status).toBe("cancelled_by_doctor");
    expect(graceAppt.needsCallback).toBe(true);
    expect(
      db
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.recommendationId, grace.id))
        .all(),
    ).toHaveLength(0);

    // 6) Replies: four accepts, Miguel counters.
    for (const name of ["Teresa", "Camille", "Andres"]) {
      await injectReply(c.id, byName(name).id, "Yes, that works. Thank you!");
    }
    await injectReply(c.id, jose.id, "Confirmed, see you then. Salamat po.");
    await injectReply(
      c.id,
      byName("Miguel").id,
      "That time doesn't work for me — I'm at work until late. Anything after 4 PM?",
    );
    await pump(); // replan enqueues nothing extra, but keep the queue drained

    // Accepted appointments are confirmed.
    for (const name of ["Teresa", "Camille", "Andres", "Jose"]) {
      const p = recsFor(c.id).find((r) => r.id === byName(name).id)!
        .payload as any;
      const appt = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, p.createdAppointmentId))
        .get()!;
      expect(appt.status).toBe("confirmed");
    }

    // 7) Miguel's replan: a fresh recommendation awaiting approval, options after 16:00.
    const c2 = getCase(c.id);
    expect(c2.state).toBe("awaiting_approval");
    const recs3 = recsFor(c.id);
    expect(recs3).toHaveLength(7);
    const miguel1 = recs3.find((r) => r.id === byName("Miguel").id)!;
    expect(miguel1.outcome).toBe("superseded");
    const replan = recs3.find(
      (r) => (r.payload as any).replanOf === miguel1.id,
    )!;
    expect(replan.status).toBe("proposed");
    const rp = replan.payload as any;
    expect(rp.patientName).toMatch(/Miguel/);
    for (const o of rp.options) expect(hhmm(o.startUtc) >= "16:00").toBe(true);

    // 8) Approve the replan, execute, Miguel accepts → resolved.
    getOrCreateNegotiation({
      caseId: c.id,
      appointmentId: replan.appointmentId!,
      patientId: replan.patientId!,
    });
    expect(
      (await decide(replan.id, { action: "approve" })).body.transitioned,
    ).toBe(true);
    await pump();
    await injectReply(
      c.id,
      replan.id,
      "4:30 PM works great. See you then, thanks for accommodating!",
    );
    const final = getCase(c.id);
    expect(final.state).toBe("resolved");
    expect(getNegotiation(c.id, replan.appointmentId!)?.status).toBe(
      "resolved",
    );

    // Miguel's chain: original → offer1 (superseded) → offer2 (confirmed).
    const finalReplan = recsFor(c.id).find((r) => r.id === replan.id)!
      .payload as any;
    const miguelFinal = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, finalReplan.createdAppointmentId))
      .get()!;
    expect(miguelFinal.status).toBe("confirmed");
    expect(hhmm(miguelFinal.startUtc) >= "16:00").toBe(true);
    const offer1Appt = db
      .select()
      .from(schema.appointments)
      .where(
        eq(
          schema.appointments.id,
          (miguel1.payload as any).createdAppointmentId,
        ),
      )
      .get()!;
    expect(offer1Appt.status).toBe("superseded");

    // 9) Scoreboard tells the recovery story.
    const s = caseScoreboard(c.id);
    expect(s.rebooked).toBe(5); // Teresa, Camille, Andres, Jose + Miguel's replan (his superseded first offer doesn't double-count)
    expect(s.confirmed).toBe(5);
    expect(s.declinedOrCallback).toBeGreaterThanOrEqual(1); // Grace

    // 10) Audit trail: staff decisions + executor effects are all present.
    const audit = db.select().from(schema.auditLog).all();
    expect(
      audit.filter((a) => a.action === "recommendation.approve").length,
    ).toBeGreaterThanOrEqual(5);
    expect(audit.some((a) => a.action === "recommendation.reject")).toBe(true);
    expect(audit.some((a) => a.action === "recommendation.modify")).toBe(true);
    expect(audit.some((a) => a.action === "appointment.rescheduled")).toBe(
      true,
    );
    expect(
      audit.some(
        (a) => a.actor === "doctor" && a.action === "doctor.marked_unavailable",
      ),
    ).toBe(true);
  }, 60000);

  it("cancellation → waitlist backfill ignores a deferred reply, then accepts a clear reply", async () => {
    // Cancel Maria's Wednesday follow-up through the normal patient path.
    const { PATCH } = await import("@/app/api/appointments/[id]/route");
    const res = await PATCH(jreq({ action: "cancel" }), {
      params: { id: "appt_maria" },
    });
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
    await injectReply(c.id, rec.id, "Okay po, I'll check muna.");
    const deferred = db
      .select()
      .from(schema.waitlist)
      .where(eq(schema.waitlist.id, "wl_nica"))
      .get()!;
    expect(deferred.status).toBe("offered");
    expect(
      db
        .select()
        .from(schema.recommendations)
        .where(eq(schema.recommendations.id, rec.id))
        .get()?.outcome,
    ).toBe("needs_human");

    await injectReply(
      c.id,
      rec.id,
      "Okay po.",
    );
    const wl = db
      .select()
      .from(schema.waitlist)
      .where(eq(schema.waitlist.id, "wl_nica"))
      .get()!;
    expect(wl.status).toBe("scheduled");
    expect(getCase(c.id).state).toBe("resolved");
  }, 30000);

  it("represents a missing recovery plan and blocks resolution until staff handles it", async () => {
    const c = openCase({
      clinicId: "clinic_riverside",
      type: "doctor_emergency",
      severity: "medium",
      title: "partial no-slot regression",
      meta: {
        doctorId: "doc_santos",
        assessment: {
          severity: "medium",
          summary: "Two patients affected.",
          items: [
            {
              appointmentId: "appt_camille",
              patientId: "pat_camille",
              patientName: "Camille Ocampo",
              type: "urgent",
              startUtc: "2026-08-10T02:40:00.000Z",
              priorityRank: 1,
              priorityReason: "urgent appointment type",
              tags: ["urgent visit"],
            },
            {
              appointmentId: "appt_grace",
              patientId: "pat_grace",
              patientName: "Grace Villanueva",
              type: "routine",
              startUtc: "2026-08-10T01:50:00.000Z",
              priorityRank: 2,
              priorityReason: "scheduled visit",
              tags: [],
            },
          ],
        },
        plans: [
          {
            appointmentId: "appt_camille",
            chosenOptionId: "opt_camille",
            rationale: "Validated replacement available.",
            options: [
              {
                id: "opt_camille",
                doctorId: "doc_reyes",
                doctorName: "Dr. Marco Reyes",
                startUtc: "2026-08-11T00:30:00.000Z",
                endUtc: "2026-08-11T01:00:00.000Z",
                day: "2026-08-11",
                block: "am",
                score: 50,
                dots: 3,
                chips: [{ label: "Next available day", pts: 20 }],
                rank: 1,
              },
            ],
          },
        ],
      },
    });
    transitionCase(c.id, "assessing", "orchestrator", "test");
    transitionCase(c.id, "planning", "orchestrator", "test");

    await commsStep(c.id);
    expect(getCase(c.id).state).toBe("awaiting_approval");
    const recs = recsFor(c.id);
    expect(recs).toHaveLength(2);
    const grace = recs.find((r) => r.patientId === "pat_grace")!;
    expect(grace.kind).toBe("callback");
    expect(grace.status).toBe("executed");
    expect(grace.outcome).toBe("needs_human");
    expect((grace.payload as any).manualReason).toBe("no_valid_replacement");
    expect(
      db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, "appt_grace"))
        .get()?.needsCallback,
    ).toBe(true);
    const scoreboard = caseScoreboard(c.id);
    expect(scoreboard.affected).toBe(2);
    expect(scoreboard.executed).toBe(0);
    expect(scoreboard.rebooked).toBe(0);
    expect(scoreboard.declinedOrCallback).toBe(1);
    const { GET: opsSummaryGET } = await import("@/app/api/ops/summary/route");
    const opsSummary = await (await opsSummaryGET()).json();
    expect(
      opsSummary.toCall.some(
        (item: any) =>
          item.patientName === "Grace Villanueva" && item.caseId === c.id,
      ),
    ).toBe(true);

    const camille = recs.find((r) => r.patientId === "pat_camille")!;
    db.update(schema.recommendations)
      .set({ status: "executed", outcome: "accepted" })
      .where(eq(schema.recommendations.id, camille.id))
      .run();
    transitionCase(c.id, "executing", "staff:test", "approved valid offer");
    transitionCase(c.id, "resolving", "executor", "tracking outcomes");
    expect(maybeResolveCase(c.id)).toBe(false);
    expect(getCase(c.id).state).toBe("resolving");

    db.update(schema.recommendations)
      .set({ outcome: "handled" })
      .where(eq(schema.recommendations.id, grace.id))
      .run();
    expect(maybeResolveCase(c.id)).toBe(true);
    expect(getCase(c.id).state).toBe("resolved");

    // A failed Calendar confirmation must leave this appointment's
    // negotiation—and a sibling thread for the same patient—active.
    const failureCase = openCase({
      clinicId: "clinic_riverside",
      type: "doctor_emergency",
      severity: "medium",
      title: "terminal negotiation failure regression",
      meta: { doctorId: "doc_santos" },
    });
    transitionCase(failureCase.id, "assessing", "orchestrator", "test");
    transitionCase(failureCase.id, "planning", "orchestrator", "test");
    transitionCase(
      failureCase.id,
      "awaiting_approval",
      "orchestrator",
      "test",
    );
    transitionCase(failureCase.id, "executing", "staff:test", "test");
    transitionCase(failureCase.id, "resolving", "executor", "test");
    const miguelAppt = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, "appt_miguel"))
      .get()!;
    db.update(schema.appointments)
      .set({
        status: "booked",
        source: "schedicare",
        calendarEventId: "missing-calendar-event",
      })
      .where(eq(schema.appointments.id, miguelAppt.id))
      .run();
    const active = getOrCreateNegotiation({
      caseId: failureCase.id,
      appointmentId: miguelAppt.id,
      patientId: miguelAppt.patientId,
    });
    const sibling = getOrCreateNegotiation({
      caseId: failureCase.id,
      appointmentId: "appt_miguel_sibling",
      patientId: miguelAppt.patientId,
    });
    recordOfferedSlot(active, {
      doctorId: miguelAppt.doctorId,
      startUtc: miguelAppt.startUtc,
      label: fmtWhen(miguelAppt.startUtc),
    });
    recordOfferedSlot(sibling, {
      doctorId: "doc_reyes",
      startUtc: "2026-08-15T01:00:00.000Z",
      label: "Saturday 9:00 AM",
    });
    db.insert(schema.recommendations)
      .values({
        id: "rec_calendar_failure",
        caseId: failureCase.id,
        appointmentId: miguelAppt.id,
        patientId: miguelAppt.patientId,
        kind: "reschedule",
        status: "executed",
        outcome: "pending",
        payload: {
          appointmentId: miguelAppt.id,
          createdAppointmentId: miguelAppt.id,
          patientId: miguelAppt.patientId,
          patientName: "Miguel Torres",
          type: miguelAppt.type,
          executedOptionId: "opt_calendar_failure",
          options: [
            {
              id: "opt_calendar_failure",
              doctorId: miguelAppt.doctorId,
              doctorName: "Dr. Elena Santos",
              startUtc: miguelAppt.startUtc,
              endUtc: miguelAppt.endUtc,
            },
          ],
        },
      })
      .run();
    db.insert(schema.messages)
      .values({
        caseId: failureCase.id,
        recommendationId: "rec_calendar_failure",
        appointmentId: miguelAppt.id,
        patientId: miguelAppt.patientId,
        direction: "outbound",
        subject: "Appointment offer",
        body: "Offered appointment",
        status: "sent",
        provider: "simulated",
      })
      .run();
    await injectReply(
      failureCase.id,
      "rec_calendar_failure",
      "Yes, that works for me.",
    );
    expect(getNegotiation(failureCase.id, miguelAppt.id)?.status).toBe(
      "active",
    );
    expect(
      (getNegotiation(failureCase.id, miguelAppt.id)?.offeredSlots as any[])
        .at(-1)?.outcome,
    ).toBe("offered");
    expect(
      getNegotiation(failureCase.id, "appt_miguel_sibling")?.status,
    ).toBe("active");
    expect(
      db
        .select()
        .from(schema.recommendations)
        .where(eq(schema.recommendations.id, "rec_calendar_failure"))
        .get()?.outcome,
    ).toBe("needs_human");
  });
});
