/**
 * The Executor. This module is the ONLY code path that performs external
 * side effects on behalf of the coordination layer, and it runs exclusively
 * for cases a staff member moved into `executing`. Before every calendar
 * write it re-runs the deterministic placement validator; a validator veto
 * beats a staff approval (the world may have changed since approval).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNowIso, fmtWhen } from "@/core/clock";
import { env } from "@/core/env";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import { getCase, maybeResolveCase, transitionCase } from "@/core/cases";
import { validatePlacementNow } from "@/core/scheduling";
import {
  pickCalendarProvider,
  pickMailProvider,
  markCalendarUnhealthy,
  markCalendarHealthy,
  markMailUnhealthy,
  markMailHealthy,
} from "@/integrations/factory";
import { SimulatedCalendarProvider } from "@/integrations/calendar/simulated";
import { SimulatedMailProvider } from "@/integrations/mail/simulated";
import { getDoctor, getPatient } from "@/agents/tools";
import { personaReply } from "@/sim/personas";
import { enqueueEvent } from "./queue";

const calLabel = (live: boolean) =>
  live ? "Google Calendar" : "Simulated calendar";
const mailLabel = (live: boolean) => (live ? "Gmail" : "Simulated mail");

export async function deleteCalendarEvent(
  caseId: string,
  calendarId: string | null,
  eventId: string | null,
  why: string,
): Promise<boolean> {
  if (!calendarId || !eventId) return true;
  const pick = pickCalendarProvider();
  try {
    await pick.provider.deleteEvent(calendarId, eventId);
    if (pick.live) markCalendarHealthy();
    timeline(
      caseId,
      "executor",
      "effect",
      `${calLabel(pick.live)}: event removed`,
      why,
      { eventId },
    );
    return true;
  } catch (e) {
    const status =
      (e as any)?.code ??
      (e as any)?.response?.status ??
      (e as any)?.response?.statusCode;

    // Deleting an event that is already absent is an idempotent success.
    // Seeded demo appointments may reference simulated event IDs that never
    // existed in Google Calendar.
    if (pick.live && status === 404) {
      markCalendarHealthy("Original event was already absent");

      timeline(
        caseId,
        "executor",
        "effect",
        "Google Calendar: original event already absent",
        why,
        { eventId },
      );

      return true;
    }

    if (pick.live) {
      markCalendarUnhealthy(e);

      timeline(
        caseId,
        "executor",
        "error",
        "Google Calendar delete failed — retrying on simulated provider",
        String((e as Error).message).slice(0, 160),
      );

      await new SimulatedCalendarProvider()
        .deleteEvent(calendarId, eventId)
        .catch(() => undefined);
    } else {
      timeline(
        caseId,
        "executor",
        "error",
        "Calendar delete failed",
        String((e as Error).message).slice(0, 160),
      );
    }
    return false;
  }
}

export async function updateCalendarEvent(
  caseId: string,
  calendarId: string | null,
  eventId: string | null,
  patch: { summary: string; description: string },
): Promise<boolean> {
  if (!calendarId || !eventId) return true;
  const pick = pickCalendarProvider();
  try {
    await pick.provider.updateEvent(calendarId, eventId, patch);
    if (pick.live) markCalendarHealthy();
    timeline(
      caseId,
      "executor",
      "effect",
      `${calLabel(pick.live)}: hold confirmed`,
      patch.summary,
      { eventId },
    );
    return true;
  } catch (e) {
    if (pick.live) markCalendarUnhealthy(e);
    timeline(
      caseId,
      "executor",
      "error",
      `${calLabel(pick.live)} update failed`,
      String((e as Error).message).slice(0, 160),
      { eventId },
    );
    return false;
  }
}

export async function createCalendarEvent(
  caseId: string,
  input: {
    calendarId: string | null;
    summary: string;
    description: string;
    startUtc: string;
    endUtc: string;
  },
): Promise<{ eventId: string | null; live: boolean }> {
  if (!input.calendarId) return { eventId: null, live: false };
  const pick = pickCalendarProvider();
  try {
    const ev = await pick.provider.createEvent({
      calendarId: input.calendarId,
      summary: input.summary,
      description: input.description,
      startUtc: input.startUtc,
      endUtc: input.endUtc,
    });
    if (pick.live) markCalendarHealthy();
    timeline(
      caseId,
      "executor",
      "effect",
      `${calLabel(pick.live)}: event created`,
      `${input.summary} — ${fmtWhen(input.startUtc)}`,
      { eventId: ev.id },
    );
    return { eventId: ev.id, live: pick.live };
  } catch (e) {
    if (pick.live) {
      markCalendarUnhealthy(e);
      timeline(
        caseId,
        "executor",
        "error",
        "Google Calendar create failed — falling back to simulated provider",
        String((e as Error).message).slice(0, 160),
      );
      const ev = await new SimulatedCalendarProvider().createEvent({
        calendarId: input.calendarId,
        summary: input.summary,
        description: input.description,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
      });
      timeline(
        caseId,
        "executor",
        "effect",
        "Simulated calendar: event created (fallback)",
        `${input.summary} — ${fmtWhen(input.startUtc)}`,
        { eventId: ev.id },
      );
      return { eventId: ev.id, live: false };
    }
    timeline(
      caseId,
      "executor",
      "error",
      "Calendar create failed",
      String((e as Error).message).slice(0, 160),
    );
    return { eventId: null, live: false };
  }
}

async function createMailDraft(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
  to: { patientId: string; email: string },
  draft: { subject: string; body: string },
  appointmentId: string | null,
): Promise<string> {
  const pick = pickMailProvider();
  let provider = pick.provider;
  let live = pick.live;
  let created: { draftId: string; threadId?: string };
  try {
    created = await provider.createDraft({
      to: to.email,
      subject: draft.subject,
      body: draft.body,
    });
    if (live) markMailHealthy();
  } catch (e) {
    if (live) {
      markMailUnhealthy(e);
      timeline(
        caseId,
        "executor",
        "error",
        "Gmail draft failed — falling back to simulated mail",
        String((e as Error).message).slice(0, 160),
      );
      provider = new SimulatedMailProvider();
      live = false;
      created = await provider.createDraft({
        to: to.email,
        subject: draft.subject,
        body: draft.body,
      });
    } else {
      throw e;
    }
  }

  const msg = db
    .insert(schema.messages)
    .values({
      caseId,
      recommendationId: rec.id,
      appointmentId,
      patientId: to.patientId,
      direction: "outbound",
      subject: draft.subject,
      body: draft.body,
      status: "draft_created",
      provider: live ? "gmail" : "simulated",
      providerDraftId: created.draftId,
      threadId: created.threadId ?? null,
      createdAt: demoNowIso(),
    })
    .returning()
    .get();
  timeline(
    caseId,
    "executor",
    "effect",
    `${mailLabel(live)}: draft created for ${getPatient(to.patientId).name}`,
    draft.subject,
    { messageId: msg.id },
  );
  audit({
    actor: "executor",
    action: "mail.draft_created",
    refType: "message",
    refId: msg.id,
    caseId,
    detail: {
      provider: live ? "gmail" : "simulated",
      draftId: created.draftId,
    },
  });

  try {
    const sent = await provider.sendDraft(created.draftId);

    db.update(schema.messages)
      .set({
        status: "sent",
        providerMessageId:
          sent.messageId ||
          (live ? null : created.draftId.replace("simdraft_", "simmsg_")),
        threadId: sent.threadId ?? created.threadId ?? null,
      })
      .where(eq(schema.messages.id, msg.id))
      .run();

    timeline(
      caseId,
      "executor",
      "effect",
      live ? "Gmail: offer sent" : "Simulated mail: offer sent",
      `to ${to.email}`,
      { messageId: msg.id, threadId: sent.threadId },
    );

    audit({
      actor: "executor",
      action: "mail.sent",
      refType: "message",
      refId: msg.id,
      caseId,
      detail: {
        provider: live ? "gmail" : "simulated",
        messageId: sent.messageId,
        threadId: sent.threadId,
      },
    });
  } catch (error) {
    if (live) {
      markMailUnhealthy(error);

      timeline(
        caseId,
        "executor",
        "error",
        "Gmail send failed — draft retained",
        String((error as Error).message).slice(0, 160),
        { messageId: msg.id, draftId: created.draftId },
      );
    }

    throw error;
  }
  return msg.id;
}

/**
 * Whether to auto-generate simulated patient replies after an offer goes out.
 * Keyed off the EFFECTIVE mail provider, not the configured MAIL_PROVIDER env.
 */
function shouldAutoReply(): boolean {
  const explicit = env().AUTO_SIMULATE_REPLIES;
  if (explicit != null) return explicit !== "false";
  return !pickMailProvider().live;
}

function scheduleSimReply(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
  messageId: string,
) {
  if (!shouldAutoReply()) return;
  const payload = rec.payload as any;
  const patientId: string = payload.patientId;
  const kind =
    rec.kind === "waitlist_fill"
      ? "waitlist"
      : rec.kind === "reschedule"
        ? payload.replanOf
          ? "replan"
          : "first"
        : "nudge";
  const script = personaReply(patientId, kind as any);
  if (!script) {
    timeline(
      caseId,
      "sim",
      "status",
      `${payload.patientName ?? "Patient"} hasn't replied (persona stays quiet)`,
      "Staff can follow up by phone if needed.",
    );
    return;
  }
  enqueueEvent(
    "simulate_reply",
    { messageId, body: script.body },
    script.delaySec,
  );
}

export async function executeCase(caseId: string): Promise<void> {
  const c = getCase(caseId);
  if (c.state !== "executing") {
    timeline(
      caseId,
      "executor",
      "error",
      `Executor called while case is ${c.state} — skipping`,
      "Only staff approval moves a case into executing.",
    );
    return;
  }
  const recs = db
    .select()
    .from(schema.recommendations)
    .where(
      and(
        eq(schema.recommendations.caseId, caseId),
        inArray(schema.recommendations.status, [
          "approved",
          "modified",
          "rejected",
        ]),
      ),
    )
    .all()
    .filter((r) => !r.executedAt);

  for (const rec of recs) {
    const payload = rec.payload as any;
    try {
      if (rec.status === "rejected") {
        await executeRejection(caseId, rec);
      } else if (rec.kind === "reschedule") {
        await executeReschedule(caseId, rec);
      } else if (rec.kind === "waitlist_fill") {
        await executeWaitlistFill(caseId, rec);
      } else {
        // confirm_nudge / preventive: mail only
        const patient = getPatient(payload.patientId);
        const msgId = await createMailDraft(
          caseId,
          rec,
          { patientId: patient.id, email: patient.email },
          payload.draft,
          payload.appointmentId ?? null,
        );
        db.update(schema.recommendations)
          .set({
            status: "executed",
            executedAt: demoNowIso(),
            outcome: "sent",
          })
          .where(eq(schema.recommendations.id, rec.id))
          .run();
        scheduleSimReply(caseId, rec, msgId);
      }
    } catch (e) {
      const msg = String((e as Error).message ?? e).slice(0, 200);
      db.update(schema.recommendations)
        .set({
          status: "failed",
          executedAt: demoNowIso(),
          outcome: "needs_human",
        })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      timeline(
        caseId,
        "executor",
        "error",
        `Execution failed for ${payload.patientName ?? rec.kind}`,
        msg,
        { recommendationId: rec.id },
      );
      audit({
        actor: "executor",
        action: "recommendation.failed",
        refType: "recommendation",
        refId: rec.id,
        caseId,
        detail: { error: msg },
      });
    }
  }

  transitionCase(
    caseId,
    "resolving",
    "executor",
    "Approved actions executed; tracking patient responses.",
  );
  maybeResolveCase(caseId, "executor");
}

async function executeRejection(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
) {
  const payload = rec.payload as any;
  if (rec.kind === "reschedule" && payload.appointmentId) {
    const appt = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, payload.appointmentId))
      .get();
    if (appt && (appt.status === "booked" || appt.status === "confirmed")) {
      db.update(schema.appointments)
        .set({ status: "cancelled_by_doctor", needsCallback: true })
        .where(eq(schema.appointments.id, appt.id))
        .run();
      await deleteCalendarEvent(
        caseId,
        getDoctor(appt.doctorId).calendarId,
        appt.calendarEventId,
        "Original appointment cancelled (offer rejected by staff)",
      );
    }
    timeline(
      caseId,
      "executor",
      "effect",
      `${payload.patientName}: original visit cancelled, marked for a staff call`,
      rec.decisionReason ?? "Staff rejected the automated offer.",
      { recommendationId: rec.id },
    );
  } else {
    timeline(
      caseId,
      "executor",
      "decision",
      `Recommendation rejected — no action taken`,
      rec.decisionReason ?? undefined,
      { recommendationId: rec.id },
    );
  }
  db.update(schema.recommendations)
    .set({ executedAt: demoNowIso(), outcome: "needs_human" })
    .where(eq(schema.recommendations.id, rec.id))
    .run();
}

async function executeReschedule(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
) {
  const payload = rec.payload as any;
  const optionId: string =
    rec.status === "modified"
      ? (payload.modifiedOptionId ?? payload.chosenOptionId)
      : payload.chosenOptionId;
  const option =
    (payload.options as any[]).find((o) => o.id === optionId) ??
    (payload.options as any[]).find((o) => o.id === payload.chosenOptionId);
  if (!option)
    throw new Error("chosen option not found on recommendation payload");

  // Hard gate: re-validate right now, ignoring the appointment being replaced.
  const check = await validatePlacementNow({
    doctorId: option.doctorId,
    type: payload.type,
    startUtc: option.startUtc,
    ignoreAppointmentId: payload.appointmentId,
  });
  if (!check.ok) {
    db.update(schema.recommendations)
      .set({
        status: "failed",
        executedAt: demoNowIso(),
        outcome: "needs_human",
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(
      caseId,
      "executor",
      "error",
      `Validator vetoed the approved slot for ${payload.patientName}`,
      check.reason,
      { recommendationId: rec.id },
    );
    audit({
      actor: "executor",
      action: "placement.vetoed",
      refType: "recommendation",
      refId: rec.id,
      caseId,
      detail: check,
    });
    return;
  }

  const oldAppt = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, payload.appointmentId))
    .get();
  const patient = getPatient(payload.patientId);
  const newDoctor = getDoctor(option.doctorId);

  const newAppt = db
    .insert(schema.appointments)
    .values({
      clinicId: oldAppt?.clinicId ?? "clinic_riverside",
      doctorId: option.doctorId,
      patientId: patient.id,
      type: payload.type,
      startUtc: option.startUtc,
      endUtc: option.endUtc,
      status: "booked",
      bookedAt: demoNowIso(),
      source: "schedicare",
      createdAt: demoNowIso(),
    })
    .returning()
    .get();

  if (oldAppt) {
    db.update(schema.appointments)
      .set({ status: "superseded", supersededBy: newAppt.id })
      .where(eq(schema.appointments.id, oldAppt.id))
      .run();
    await deleteCalendarEvent(
      caseId,
      getDoctor(oldAppt.doctorId).calendarId,
      oldAppt.calendarEventId,
      `Superseded by ${fmtWhen(option.startUtc)}`,
    );
  }

  const created = await createCalendarEvent(caseId, {
    calendarId: newDoctor.calendarId,
    summary: `[HOLD] ${patient.name} — ${String(payload.type).replace("_", " ")}`,
    description: `Slot held by SchediCare pending patient confirmation. Case ${caseId}.`,
    startUtc: option.startUtc,
    endUtc: option.endUtc,
  });
  if (created.eventId) {
    db.update(schema.appointments)
      .set({ calendarEventId: created.eventId })
      .where(eq(schema.appointments.id, newAppt.id))
      .run();
  }

  const msgId = await createMailDraft(
    caseId,
    rec,
    { patientId: patient.id, email: patient.email },
    payload.draft,
    newAppt.id,
  );

  db.update(schema.recommendations)
    .set({
      status: "executed",
      executedAt: demoNowIso(),
      outcome: "pending",
      payload: {
        ...payload,
        executedOptionId: option.id,
        createdAppointmentId: newAppt.id,
      },
    })
    .where(eq(schema.recommendations.id, rec.id))
    .run();
  audit({
    actor: "executor",
    action: "appointment.rescheduled",
    refType: "appointment",
    refId: newAppt.id,
    caseId,
    detail: {
      from: payload.from,
      to: { startUtc: option.startUtc, doctorId: option.doctorId },
    },
  });
  timeline(
    caseId,
    "executor",
    "effect",
    `${patient.name}: slot held pending patient confirmation`,
    `${fmtWhen(option.startUtc)} with ${newDoctor.name}.`,
    { appointmentId: newAppt.id },
  );

  scheduleSimReply(
    caseId,
    {
      ...rec,
      payload: { ...payload, createdAppointmentId: newAppt.id },
    } as any,
    msgId,
  );
}

async function executeWaitlistFill(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
) {
  const payload = rec.payload as any;
  const slot = payload.slot;
  const check = await validatePlacementNow({
    doctorId: slot.doctorId,
    type: payload.slotType,
    startUtc: slot.startUtc,
  });
  if (!check.ok) {
    db.update(schema.recommendations)
      .set({
        status: "failed",
        executedAt: demoNowIso(),
        outcome: "needs_human",
      })
      .where(eq(schema.recommendations.id, rec.id))
      .run();
    timeline(
      caseId,
      "executor",
      "error",
      "Validator vetoed the waitlist slot (it may have been rebooked)",
      check.reason,
      { recommendationId: rec.id },
    );
    return;
  }
  const patient = getPatient(payload.patientId);
  const doctor = getDoctor(slot.doctorId);
  const newAppt = db
    .insert(schema.appointments)
    .values({
      clinicId: "clinic_riverside",
      doctorId: slot.doctorId,
      patientId: patient.id,
      type: payload.slotType,
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      status: "booked",
      bookedAt: demoNowIso(),
      source: "schedicare",
      createdAt: demoNowIso(),
    })
    .returning()
    .get();
  const created = await createCalendarEvent(caseId, {
    calendarId: doctor.calendarId,
    summary: `[HOLD] ${patient.name} — ${String(payload.slotType).replace("_", " ")}`,
    description: `Waitlist slot held by SchediCare pending patient confirmation. Case ${caseId}.`,
    startUtc: slot.startUtc,
    endUtc: slot.endUtc,
  });
  if (created.eventId)
    db.update(schema.appointments)
      .set({ calendarEventId: created.eventId })
      .where(eq(schema.appointments.id, newAppt.id))
      .run();
  db.update(schema.waitlist)
    .set({ status: "offered" })
    .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
    .run();

  const msgId = await createMailDraft(
    caseId,
    rec,
    { patientId: patient.id, email: patient.email },
    payload.draft,
    newAppt.id,
  );
  db.update(schema.recommendations)
    .set({
      status: "executed",
      executedAt: demoNowIso(),
      outcome: "pending",
      payload: { ...payload, createdAppointmentId: newAppt.id },
    })
    .where(eq(schema.recommendations.id, rec.id))
    .run();
  audit({
    actor: "executor",
    action: "waitlist.offered",
    refType: "appointment",
    refId: newAppt.id,
    caseId,
    detail: { waitlistId: payload.chosenWaitlistId },
  });
  timeline(
    caseId,
    "executor",
    "effect",
    `${patient.name}: slot held pending patient confirmation`,
    `${fmtWhen(slot.startUtc)} with ${doctor.name}.`,
    { appointmentId: newAppt.id },
  );
  scheduleSimReply(caseId, rec, msgId);
}
