/**
 * Boot/daily sweep (idempotent per demo day). Turns quiet problems into cases:
 *  - unconfirmed appointments starting within 36 hours → confirmation case
 *  - high no-show-risk appointments (Attendance-Risk agent) → no_show_risk case
 *  - future slots vacated by patient cancellations → slot_recovery case
 */
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNow, demoToday } from "@/core/clock";
import { localDayOf as localDay } from "@/core/slots";
import { differenceInHours } from "date-fns";
import { getStatus, setStatus } from "@/core/status";
import { audit } from "@/core/audit";
import { openCase } from "@/core/cases";
import { runRisk } from "@/agents/risk";
import { getPatient } from "@/agents/tools";
import { enqueueEvent } from "./queue";

function caseExistsFor(type: string, appointmentId: string): boolean {
  const rows = db
    .select({ id: schema.cases.id, meta: schema.cases.meta })
    .from(schema.cases)
    .where(eq(schema.cases.type, type as any))
    .all();
  return rows.some(
    (r) => ((r.meta as any)?.appointmentId ?? "") === appointmentId,
  );
}

export async function runDailySweep(): Promise<void> {
  const key = `sweep:${demoToday()}`;
  if (getStatus<{ done: boolean }>(key)?.done) return;
  setStatus(key, { done: true, at: new Date().toISOString() });
  audit({
    actor: "system",
    action: "sweep.started",
    detail: { day: demoToday() },
  });

  // 1) Unconfirmed within 36h → confirmation case.
  const active = db
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.status, "booked"),
        gt(schema.appointments.startUtc, demoNow().toISOString()),
      ),
    )
    .all();
  for (const a of active) {
    const hours = differenceInHours(new Date(a.startUtc), demoNow());
    if (hours > 36) continue;
    // Same-day unconfirmed visits are front-desk phone territory, not email
    // nudges — the sweep targets tomorrow's unconfirmed bookings.
    if (
      a.startUtc.slice(0, 10) === demoNow().toISOString().slice(0, 10) ||
      localDay(a.startUtc) === demoToday()
    )
      continue;
    if (caseExistsFor("confirmation", a.id)) continue;
    const p = getPatient(a.patientId);
    const c = openCase({
      clinicId: a.clinicId,
      type: "confirmation",
      severity: "low",
      title: `Unconfirmed: ${p.name} in ${hours}h`,
      meta: { appointmentId: a.id, patientId: a.patientId },
    });
    enqueueEvent("start_case", { caseId: c.id });
  }

  // 2) High no-show risk (Attendance-Risk agent) → no_show_risk case.
  const risk = await runRisk(
    { caseId: null, horizonDays: 7, minBand: "high" },
    { caseId: null },
  );
  for (const flag of risk.output.flags) {
    const appt = db
      .select()
      .from(schema.appointments)
      .where(eq(schema.appointments.id, flag.appointmentId))
      .get();
    // Unconfirmed ("booked") appointments are the riskiest — the scorer gives
    // +25 for exactly that — so they must not be filtered out here. Only
    // terminal statuses (cancelled/completed/superseded/no_show) are skipped.
    if (!appt || !["booked", "confirmed"].includes(appt.status)) continue;
    if (caseExistsFor("no_show_risk", flag.appointmentId)) continue;
    const c = openCase({
      clinicId: appt.clinicId,
      type: "no_show_risk",
      severity: "medium",
      title: `No-show risk ${flag.score}/100: ${flag.patientName}`,
      meta: {
        appointmentId: flag.appointmentId,
        patientId: flag.patientId,
        flag,
      },
    });
    enqueueEvent("start_case", { caseId: c.id });
  }

  // 3) Vacated future slots → slot_recovery case.
  const cancelled = db
    .select()
    .from(schema.appointments)
    .where(
      and(
        inArray(schema.appointments.status, ["cancelled_by_patient"]),
        gt(schema.appointments.startUtc, demoNow().toISOString()),
      ),
    )
    .all();
  for (const a of cancelled) {
    if (caseExistsFor("slot_recovery", a.id)) continue;
    const p = getPatient(a.patientId);
    const c = openCase({
      clinicId: a.clinicId,
      type: "slot_recovery",
      severity: "low",
      title: `Vacated slot: ${p.name} cancelled`,
      meta: { appointmentId: a.id, patientId: a.patientId },
    });
    enqueueEvent("start_case", { caseId: c.id });
  }

  audit({
    actor: "system",
    action: "sweep.finished",
    detail: { day: demoToday() },
  });
}
