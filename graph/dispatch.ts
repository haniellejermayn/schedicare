/**
 * Event → graph dispatch. The SQLite event queue stays the ingress (delayed
 * events power simulated reply timing); every event either opens a case and
 * starts its graph, or wakes a paused graph after new information landed.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { openCase } from "@/core/cases";
import { audit } from "@/core/audit";
import { demoNowIso, fmtWhen } from "@/core/clock";
import { getDoctor, getPatient } from "@/agents/tools";
import { handlePatientReply } from "@/worker/replies";
import { startCase, resumeCase } from "@/graph/caseGraph";

export async function dispatchEvent(ev: typeof schema.events.$inferSelect): Promise<void> {
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
      await startCase(c.id);
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
      await startCase(c.id);
      return;
    }
    case "start_case": {
      await startCase(payload.caseId);
      return;
    }
    case "resume_case": {
      await resumeCase(payload.caseId);
      return;
    }
    case "patient_reply": {
      const caseId = await handlePatientReply(payload.messageId);
      if (caseId) await resumeCase(caseId);
      return;
    }
    case "simulate_reply": {
      const caseId = await injectSimulatedReply(payload.messageId, payload.body);
      if (caseId) await resumeCase(caseId);
      return;
    }
    default:
      audit({ actor: "worker", action: "event.unknown", detail: { type: ev.type } });
  }
}

/** Insert a simulated inbound message on an outbound thread, then handle it. */
export async function injectSimulatedReply(outboundMessageId: string, body: string): Promise<string | null> {
  const outbound = db.select().from(schema.messages).where(eq(schema.messages.id, outboundMessageId)).get();
  if (!outbound) return null;
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
  return handlePatientReply(inbound.id);
}
