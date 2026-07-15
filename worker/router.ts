/**
 * Event router. Maps queue events to handlers. Case-opening triggers go
 * through the Orchestrator (live Gemini when available, deterministic playbook
 * otherwise); mechanical events (execution, replies) go straight to their
 * handlers — they are not agent decisions.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNowIso, demoToday, fmtWhen } from "@/core/clock";
import { timeline } from "@/core/timeline";
import { audit } from "@/core/audit";
import { escalateCase, getCase, openCase } from "@/core/cases";
import { AgentFailure } from "@/agents/runtime/types";
import { orchestrate } from "@/agents/orchestrator";
import { getDoctor, getPatient } from "@/agents/tools";
import { executeCase } from "./executor";
import { handlePatientReply } from "./replies";
import { enqueueEvent } from "./queue";

export async function routeEvent(ev: typeof schema.events.$inferSelect): Promise<void> {
  const payload = ev.payload as any;
  switch (ev.type) {
    case "doctor_emergency": {
      const doctor = getDoctor(payload.doctorId);
      const c = openCase({
        clinicId: doctor.clinicId,
        type: "doctor_emergency",
        severity: "high",
        title: `${doctor.name} unavailable — ${payload.date}`,
        openedByEvent: ev.id,
        meta: { doctorId: payload.doctorId, date: payload.date, reason: payload.reason ?? "emergency" },
      });
      await runOrchestration(c.id);
      return;
    }
    case "patient_cancelled": {
      const appt = db.select().from(schema.appointments).where(eq(schema.appointments.id, payload.appointmentId)).get();
      if (!appt) return;
      const p = getPatient(appt.patientId);
      const c = openCase({
        clinicId: appt.clinicId,
        type: "patient_cancellation",
        severity: "low",
        title: `Vacated slot: ${p.name} cancelled ${fmtWhen(appt.startUtc)}`,
        openedByEvent: ev.id,
        meta: { appointmentId: appt.id, patientId: appt.patientId },
      });
      await runOrchestration(c.id);
      return;
    }
    case "orchestrate_case": {
      await runOrchestration(payload.caseId);
      return;
    }
    case "execute_case": {
      await executeCase(payload.caseId);
      return;
    }
    case "patient_reply": {
      await handlePatientReply(payload.messageId);
      return;
    }
    case "simulate_reply": {
      await injectSimulatedReply(payload.messageId, payload.body);
      return;
    }
    default:
      audit({ actor: "worker", action: "event.unknown", detail: { type: ev.type } });
  }
}

async function runOrchestration(caseId: string): Promise<void> {
  const c = getCase(caseId);
  if (!["open", "assessing", "planning"].includes(c.state)) {
    timeline(caseId, "orchestrator", "status", `Orchestration skipped — case already ${c.state}`);
    return;
  }
  try {
    await orchestrate(
      {
        caseId,
        caseType: c.type as any,
        title: c.title,
        contextSummary: JSON.stringify(c.meta ?? {}).slice(0, 600),
      },
      { caseId }
    );
  } catch (e) {
    if (e instanceof AgentFailure) {
      escalateCase(caseId, "orchestrator", `Automated handling failed (${e.stage}): ${e.message.slice(0, 200)}`);
      return;
    }
    throw e;
  }
}

/**
 * Presentation Resilience Mode: a persona reply lands in the same thread as
 * the outbound message and flows through the normal inbound pipeline.
 */
async function injectSimulatedReply(outboundMessageId: string, body: string): Promise<void> {
  const outbound = db.select().from(schema.messages).where(eq(schema.messages.id, outboundMessageId)).get();
  if (!outbound) return;
  const patient = getPatient(outbound.patientId);
  const inbound = db
    .insert(schema.messages)
    .values({
      caseId: outbound.caseId,
      recommendationId: outbound.recommendationId,
      appointmentId: outbound.appointmentId,
      patientId: outbound.patientId,
      direction: "inbound",
      subject: `Re: ${outbound.subject ?? "your appointment"}`,
      body,
      status: "received",
      provider: "simulated",
      threadId: outbound.threadId,
      createdAt: demoNowIso(),
    })
    .returning()
    .get();
  audit({ actor: "sim", action: "mail.inbound_simulated", refType: "message", refId: inbound.id, caseId: outbound.caseId, detail: { from: patient.email } });
  await handlePatientReply(inbound.id);
}

export function bootBanner(): string {
  return `[worker] SchediCare worker up — demo day ${demoToday()}`;
}
