/**
 * Inbound reply pipeline: pre-filter guard → Communication agent interpretation
 * → routing. All inbound text is treated as untrusted data end to end; the
 * guard runs BEFORE any model sees the reply, and the only things a reply can
 * cause directly are: confirming its own appointment, flagging a callback, or
 * kicking off a replan that itself ends in staff approval.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNowIso, fmtWhen } from "@/core/clock";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import {
  escalateCase,
  getCase,
  maybeResolveCase,
  updateCaseMeta,
} from "@/core/cases";
import { guardReply, runCommsInterpret } from "@/agents/comms";
import { getDoctor, getPatient } from "@/agents/tools";
import { replanSingle } from "./steps";
import {
  deleteCalendarEvent,
  updateCalendarEvent,
} from "./executor";
import type { ReplyInterpretation } from "@/core/types";

function latestReplyOnly(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").trim();

  const quotedMarkers = [
    // Normal Gmail text reply
    /\nOn [^\n]{1,500}?wrote:\s*\n/i,

    // Gmail may place the quote marker on the same line
    /\sOn [^\n]{1,500}?wrote:\s*(?=>)/i,

    // Outlook-style forwarding/replies
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,

    // Header-style quoted block
    /\nFrom:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+/i,
  ];

  let cutAt = text.length;

  for (const marker of quotedMarkers) {
    const match = marker.exec(text);
    if (match && match.index < cutAt) {
      cutAt = match.index;
    }
  }

  const latest = text
    .slice(0, cutAt)
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();

  return latest || text.slice(0, 1000);
}

export async function handlePatientReply(
  messageId: string,
): Promise<string | null> {
  const msg = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.id, messageId))
    .get();
  if (!msg || msg.direction !== "inbound") return null;
  if (msg.status === "interpreted") return msg.caseId; // idempotent
  const caseId = msg.caseId;
  const rec = msg.recommendationId
    ? db
        .select()
        .from(schema.recommendations)
        .where(eq(schema.recommendations.id, msg.recommendationId))
        .get()
    : undefined;
  const patient = getPatient(msg.patientId);
  const replyBody = latestReplyOnly(msg.body);

  if (caseId) {
    timeline(
      caseId,
      "comms",
      "message",
      `Reply received from ${patient.name}`,
      replyBody.slice(0, 300),
      { messageId },
    );
  }

  // 1) Guard — never auto-handle medical/injection/upset content.
  const guard = guardReply(replyBody);
  let interp: ReplyInterpretation;
  if (guard.hit) {
    interp = { intent: "needs_human", confidence: 1, summary: guard.reason! };
    if (caseId)
      timeline(
        caseId,
        "comms",
        "escalation",
        "Reply quarantined for human review",
        guard.reason,
      );
  } else {
    const payload = (rec?.payload as any) ?? {};
    const res = await runCommsInterpret(
      {
        caseId,
        patientName: patient.name,
        outboundSubject: msg.subject ?? "your appointment",
        outboundSummary: payload.draft?.subject ?? "scheduling message",
        replyBody,
      },
      { caseId },
    );
    interp = res.output;
    if (interp.confidence < 0.6 && interp.intent !== "needs_human") {
      interp = {
        ...interp,
        intent: "needs_human",
        summary: `${interp.summary} (low confidence — routed to staff)`,
      };
    }
  }

  db.update(schema.messages)
    .set({
      status: "interpreted",
      intent: interp.intent,
      intentDetail: interp as any,
    })
    .where(eq(schema.messages.id, messageId))
    .run();
  audit({
    actor: "comms",
    action: "reply.interpreted",
    refType: "message",
    refId: messageId,
    caseId,
    detail: interp,
  });
  if (caseId)
    timeline(
      caseId,
      "comms",
      "status",
      `Interpreted as ${interp.intent.replace(/_/g, " ")}`,
      interp.summary,
      { intent: interp.intent },
    );

  if (!caseId || !rec) return caseId;
  await route(caseId, rec, msg, patient.name, interp);
  return caseId;
}

async function route(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
  msg: typeof schema.messages.$inferSelect,
  patientName: string,
  interp: ReplyInterpretation,
) {
  const payload = rec.payload as any;
  const targetApptId: string | undefined =
    payload.createdAppointmentId ?? payload.appointmentId;

  switch (interp.intent) {
    case "confirm":
    case "accept_offer": {
      if (targetApptId) {
        const appt = db
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, targetApptId))
          .get();
        if (appt && !["booked", "confirmed"].includes(appt.status)) {
          db.update(schema.recommendations)
            .set({ outcome: "needs_human" })
            .where(eq(schema.recommendations.id, rec.id))
            .run();
          timeline(
            caseId,
            "orchestrator",
            "escalation",
            `${patientName} accepted after the hold was released — staff follow-up needed`,
            "The slot must be checked again before confirming.",
            { appointmentId: targetApptId, recommendationId: rec.id },
          );
          break;
        }
        db.update(schema.appointments)
          .set({ status: "confirmed" })
          .where(eq(schema.appointments.id, targetApptId))
          .run();
        if (appt?.calendarEventId) {
          const doctor = getDoctor(appt.doctorId);
          await updateCalendarEvent(
            caseId,
            doctor.calendarId,
            appt.calendarEventId,
            {
              summary: `${patientName} — ${String(appt.type).replace("_", " ")}`,
              description: `Confirmed by patient through SchediCare. Case ${caseId}.`,
            },
          );
        }
        if (rec.kind === "waitlist_fill") {
          db.update(schema.waitlist)
            .set({ status: "scheduled" })
            .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
            .run();
        }
        db.update(schema.recommendations)
          .set({ outcome: "accepted" })
          .where(eq(schema.recommendations.id, rec.id))
          .run();
        timeline(
          caseId,
          "orchestrator",
          "status",
          `${patientName} confirmed ${appt ? fmtWhen(appt.startUtc) : "the new time"} ✓`,
          undefined,
          { appointmentId: targetApptId },
        );
        audit({
          actor: "system",
          action: "appointment.confirmed_by_reply",
          refType: "appointment",
          refId: targetApptId,
          caseId,
        });
      } else {
        db.update(schema.recommendations)
          .set({ outcome: "accepted" })
          .where(eq(schema.recommendations.id, rec.id))
          .run();
      }
      break;
    }
    case "reject_offer":
    case "cancel": {
      db.update(schema.recommendations)
        .set({ outcome: "declined" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      if (targetApptId) {
        const appt = db
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, targetApptId))
          .get();
        db.update(schema.appointments)
          .set({ status: "cancelled_by_patient", needsCallback: true })
          .where(eq(schema.appointments.id, targetApptId))
          .run();
        if (appt) {
          await deleteCalendarEvent(
            caseId,
            getDoctor(appt.doctorId).calendarId,
            appt.calendarEventId,
            "Patient declined or cancelled the offered time.",
          );
        }
        if (rec.kind === "waitlist_fill") {
          db.update(schema.waitlist)
            .set({ status: "waiting" })
            .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
            .run();
        }
      }
      const m = (getCase(caseId).meta as any) ?? {};
      updateCaseMeta(caseId, {
        needsCallback: [
          ...(m.needsCallback ?? []),
          { patientId: msg.patientId, patientName, reason: interp.summary },
        ],
      });
      timeline(
        caseId,
        "orchestrator",
        "escalation",
        `${patientName} declined — marked for a staff call`,
        interp.summary,
        { recommendationId: rec.id },
      );
      break;
    }
    case "counter_proposal": {
      // Replanning only makes sense for reschedule offers. A counter on a
      // waitlist offer / nudge is a conversation for the front desk.
      if (rec.kind !== "reschedule") {
        db.update(schema.recommendations)
          .set({ outcome: "needs_human" })
          .where(eq(schema.recommendations.id, rec.id))
          .run();
        db.update(schema.messages)
          .set({ status: "interpreted" })
          .where(eq(schema.messages.id, msg.id))
          .run();
        timeline(
          caseId,
          "comms",
          "escalation",
          `${patientName} asked for a different arrangement — staff follow-up needed`,
          interp.summary,
          { messageId: msg.id },
        );
        audit({
          actor: "comms",
          action: "reply.needs_human",
          refType: "message",
          refId: msg.id,
          caseId,
        });
        maybeResolveCase(caseId);
        break;
      }
      db.update(schema.recommendations)
        .set({ outcome: "superseded" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      // Replan targets the appointment the offer created (or the original if
      // execution created none); a synthetic assessment item keeps the
      // standard pipeline working for this one patient.
      const apptId = targetApptId!;
      const appt = db
        .select()
        .from(schema.appointments)
        .where(eq(schema.appointments.id, apptId))
        .get();
      const c = getCase(caseId);
      const meta = (c.meta as any) ?? {};
      const items = (meta.assessment?.items ?? []).filter(
        (x: any) => x.appointmentId !== apptId,
      );
      const orig = (meta.assessment?.items ?? []).find(
        (x: any) => x.appointmentId === payload.appointmentId,
      );
      items.push({
        appointmentId: apptId,
        patientId: msg.patientId,
        patientName,
        type: appt?.type ?? payload.type,
        startUtc: appt?.startUtc ?? payload.from?.startUtc,
        priorityRank: orig?.priorityRank ?? 1,
        priorityReason: `Patient counter-proposal: ${interp.summary}`,
        tags: ["counter-proposal"],
      });
      updateCaseMeta(caseId, {
        assessment: {
          ...(meta.assessment ?? { severity: c.severity, summary: "" }),
          items,
        },
      });
      const constraintBits = [
        interp.constraint?.afterTime && `after ${interp.constraint.afterTime}`,
        interp.constraint?.beforeTime &&
          `before ${interp.constraint.beforeTime}`,
        interp.constraint?.dayPart &&
          (interp.constraint.dayPart === "am" ? "mornings" : "afternoons"),
        interp.constraint?.preferredDay &&
          `on ${interp.constraint.preferredDay}`,
      ]
        .filter(Boolean)
        .join(", ");
      await replanSingle(caseId, {
        appointmentId: apptId,
        supersededRecId: rec.id,
        constraint: interp.constraint ?? {},
        note: constraintBits || interp.summary,
      });
      break;
    }
    case "question":
    case "needs_human": {
      db.update(schema.recommendations)
        .set({ outcome: "needs_human" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      escalateCase(
        caseId,
        "comms",
        `${patientName}'s reply needs a person: ${interp.summary}`,
      );
      break;
    }
  }
  maybeResolveCase(caseId);
}
