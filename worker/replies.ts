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
import { extractConstraints } from "@/agents/constraintExtractor";
import { aiLiveWanted } from "@/agents/runtime";
import {
  describeConstraintDiff,
  describeConstraintSet,
  diffConstraintSets,
  toLegacyInterpretation,
  triageConstraintSet,
} from "@/core/constraints";
import { validateConstraintSet } from "@/core/constraintValidation";
import { getDoctor, getPatient } from "@/agents/tools";
import { replanSingle, replanWithConstraintSet } from "./steps";
import { negotiationTurn } from "./negotiation";
import { findSlotsForConstraints } from "@/core/constraintMatching";
import {
  getOrCreateNegotiation,
  recordOfferOutcome,
  updateNegotiation,
} from "@/core/negotiations";
import type { SchedulingConstraintSet } from "@/core/constraints";
import { deleteCalendarEvent, updateCalendarEvent } from "./executor";
import type { ReplyInterpretation } from "@/core/types";
import { latestReplyOnly } from "@/core/messages";

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
  let richSet: SchedulingConstraintSet | null = null;
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
  } else if (aiLiveWanted()) {
    // Live path: rich constraint extraction. The model proposes a
    // SchedulingConstraintSet; deterministic triage decides the lane. In
    // fallback/resilience mode this branch is skipped entirely and the
    // legacy deterministic path below runs unchanged.
    const payload = (rec?.payload as any) ?? {};
    // Per-appointment memory: the merge prior belongs to THIS thread only.
    const constraintKey: string | null =
      payload.appointmentId ?? msg.appointmentId ?? null;
    const prior =
      caseId && constraintKey
        ? ((((getCase(caseId).meta as any) ?? {}).constraintsByAppt ?? {})[
            constraintKey
          ]?.set ?? null)
        : null;
    const run = await extractConstraints(
      {
        caseId,
        replyBody,
        patientName: patient.name,
        // A reply to a CLARIFICATION can only be interpreted against the
        // question we asked — "sige po" means nothing without it. For offer
        // threads, the subject line suffices.
        outboundContext:
          rec?.kind === "clarification"
            ? `We asked the patient: "${payload.question}"${
                (payload.choices?.length ?? 0) > 0
                  ? ` (suggested answers: ${payload.choices.join(" / ")})`
                  : ""
              }`
            : (payload.draft?.subject ?? msg.subject ?? undefined),
        priorConstraints: prior ?? undefined,
      },
      { caseId },
    );
    const v = validateConstraintSet(run.output);
    const set = v.ok ? v.normalized : run.output;
    const triage = triageConstraintSet(set, v);
    if (v.ok && !set.clinicalContentDetected) richSet = set;
    // Multi-turn audit: the diff WE compute between the prior accumulated set
    // and the merged output — never the model's own account of what changed.
    const diff =
      prior && run.mode === "live" ? diffConstraintSets(prior, set) : [];

    // Persist the rich set for the constraint editor regardless of lane —
    // keyed PER APPOINTMENT with the patient identity captured here, so
    // parallel patients on one case can never clobber or cross-contaminate
    // each other (the bug that once had the negotiator asking Miguel about
    // Camille's constraints).
    if (caseId && constraintKey)
      updateCaseMeta(caseId, {
        constraintsByAppt: {
          ...(((getCase(caseId).meta as any) ?? {}).constraintsByAppt ?? {}),
          [constraintKey]: {
            set,
            appointmentId: constraintKey,
            patientId: msg.patientId,
            patientName: patient.name,
            recommendationId: rec?.id ?? null,
            messageId,
            extractedAt: demoNowIso(),
            mode: run.mode,
            validation: { ok: v.ok, errors: v.errors, warnings: v.warnings },
            disposition: triage.disposition,
            reason: triage.reason,
            diff: diff.length > 0 ? diff : undefined,
          },
        },
      });
    if (caseId && diff.length > 0)
      timeline(
        caseId,
        "extractor",
        "status",
        "Constraints updated from the new reply",
        describeConstraintDiff(diff),
        { messageId },
      );

    interp = toLegacyInterpretation(set);
    if (caseId)
      timeline(
        caseId,
        "extractor",
        triage.disposition === "route_legacy" ? "status" : "escalation",
        triage.disposition === "constraint_review"
          ? "Constraints extracted — awaiting staff review in the constraint editor"
          : `Constraints extracted (${triage.disposition.replace(/_/g, " ")})`,
        `${set.summary} · ${describeConstraintSet(set)} · ${triage.reason}`,
        { messageId, disposition: triage.disposition },
      );
    if (triage.disposition !== "route_legacy") {
      interp = {
        intent: "needs_human",
        confidence: set.confidence,
        summary:
          triage.disposition === "constraint_review"
            ? `Compound constraints ready for staff review — ${set.summary}`.slice(
                0,
                300,
              )
            : `${triage.reason} — ${set.summary}`.slice(0, 300),
      };
    }
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
  await route(caseId, rec, msg, patient.name, interp, richSet);
  return caseId;
}

async function route(
  caseId: string,
  rec: typeof schema.recommendations.$inferSelect,
  msg: typeof schema.messages.$inferSelect,
  patientName: string,
  interp: ReplyInterpretation,
  richSet: SchedulingConstraintSet | null = null,
) {
  const payload = rec.payload as any;
  const targetApptId: string | undefined =
    payload.createdAppointmentId ?? payload.appointmentId;

  // Replies to a CLARIFICATION are negotiation moves, not offer decisions:
  // there is no held slot to confirm or release. Any substantive answer
  // (acceptance of a relaxation, a new counter, or a refusal) re-enters the
  // loop with the merged constraints; without a live extraction, or for
  // questions, a person takes over.
  if (rec.kind === "clarification" && interp.intent !== "cancel") {
    const substantive = [
      "confirm",
      "accept_offer",
      "reject_offer",
      "counter_proposal",
    ].includes(interp.intent);
    if (substantive && richSet && payload.appointmentId) {
      timeline(
        caseId,
        "negotiator",
        "status",
        `${patientName} answered the question`,
        interp.summary,
        {
          recommendationId: rec.id,
        },
      );
      await negotiationTurn({
        caseId,
        appointmentId: payload.appointmentId,
        patientId: msg.patientId,
        patientName,
        supersededRecId: rec.id,
        set: richSet,
      });
    } else {
      db.update(schema.recommendations)
        .set({ outcome: "needs_human" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
      escalateCase(
        caseId,
        "negotiator",
        `${patientName} replied to our question — staff should read it: ${interp.summary}`,
      );
    }
    maybeResolveCase(caseId);
    return;
  }

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
        if (appt?.calendarEventId) {
          const doctor = getDoctor(appt.doctorId);
          const updated = await updateCalendarEvent(
            caseId,
            doctor.calendarId,
            appt.calendarEventId,
            {
              summary: `${patientName} — ${String(appt.type).replace("_", " ")}`,
              description: `Confirmed by patient through SchediCare. Case ${caseId}.`,
            },
          );
          if (!updated) {
            db.update(schema.recommendations)
              .set({ outcome: "needs_human" })
              .where(eq(schema.recommendations.id, rec.id))
              .run();
            timeline(
              caseId,
              "orchestrator",
              "escalation",
              `${patientName} accepted, but Calendar could not confirm the hold`,
              "The appointment remains on hold for staff follow-up.",
              { appointmentId: targetApptId, recommendationId: rec.id },
            );
            break;
          }
        }
        db.update(schema.appointments)
          .set({ status: "confirmed", needsCallback: false })
          .where(eq(schema.appointments.id, targetApptId))
          .run();
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
      if (targetApptId) {
        const appt = db
          .select()
          .from(schema.appointments)
          .where(eq(schema.appointments.id, targetApptId))
          .get();
        if (appt) {
          const deleted = await deleteCalendarEvent(
            caseId,
            getDoctor(appt.doctorId).calendarId,
            appt.calendarEventId,
            "Patient declined or cancelled the offered time.",
          );
          if (!deleted) {
            db.update(schema.recommendations)
              .set({ outcome: "needs_human" })
              .where(eq(schema.recommendations.id, rec.id))
              .run();
            timeline(
              caseId,
              "orchestrator",
              "escalation",
              `${patientName} declined, but Calendar could not release the hold`,
              "The appointment remains active for staff follow-up.",
              { appointmentId: targetApptId, recommendationId: rec.id },
            );
            break;
          }
        }
        db.update(schema.appointments)
          .set({ status: "cancelled_by_patient", needsCallback: true })
          .where(eq(schema.appointments.id, targetApptId))
          .run();
        if (rec.kind === "waitlist_fill") {
          db.update(schema.waitlist)
            .set({ status: "waiting" })
            .where(eq(schema.waitlist.id, payload.chosenWaitlistId))
            .run();
        }
      }
      db.update(schema.recommendations)
        .set({ outcome: "declined" })
        .where(eq(schema.recommendations.id, rec.id))
        .run();
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
      // Negotiation engagement (live extractions only): the policy takes
      // over on second-and-later rounds and whenever zero slots match as
      // stated; the very first simple counter keeps the fast replan path.
      if (richSet) {
        const c2 = getCase(caseId);
        const meta2 = (c2.meta as any) ?? {};
        const nego = getOrCreateNegotiation({
          caseId,
          appointmentId: apptId,
          patientId: msg.patientId,
          constraintSet: richSet,
        });
        if (
          ((nego.offeredSlots as any[]) ?? []).some(
            (o) => o.outcome === "offered",
          )
        )
          recordOfferOutcome(nego, "declined", interp.summary.slice(0, 160));
        const matching = await findSlotsForConstraints({
          set: richSet,
          type: appt?.type ?? payload.type,
          ignoreAppointmentId: apptId,
          originalDoctorId: meta2.doctorId ?? appt?.doctorId,
          horizonDays: 14,
          limit: 1,
        });
        if (nego.turn >= 1 || matching.length === 0) {
          await negotiationTurn({
            caseId,
            appointmentId: apptId,
            patientId: msg.patientId,
            patientName,
            supersededRecId: rec.id,
            set: richSet,
          });
          break;
        }
        // First simple round: fast path, but the round still counts and the
        // offered slot is recorded by replanWithConstraintSet's twin below.
        await replanWithConstraintSet(caseId, {
          appointmentId: apptId,
          supersededRecId: rec.id,
          set: richSet,
          note: constraintBits || interp.summary,
        });
        break;
      }
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
