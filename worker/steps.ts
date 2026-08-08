/**
 * Case-pipeline steps. Each step reads/writes case meta so data flows between
 * agents server-side. The live Orchestrator (Gemini) sequences these as tools;
 * Presentation Resilience Mode runs the exact same functions in a fixed order.
 * No step performs external writes — that is exclusively the executor's job,
 * behind the staff approval gate.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoToday, fmtWhen, sleep } from "@/core/clock";
import { env } from "@/core/env";
import { timeline } from "@/core/timeline";
import { findSlotsForConstraints } from "@/core/constraintMatching";
import {
  getOrCreateNegotiation,
  recordOfferedSlot,
  updateNegotiation,
} from "@/core/negotiations";
import {
  describeConstraintSet,
  type SchedulingConstraintSet,
} from "@/core/constraints";
import { audit } from "@/core/audit";
import { getCase, transitionCase, updateCaseMeta } from "@/core/cases";
import { validatePlacementNow } from "@/core/scheduling";
import { blockOf, localDayOf } from "@/core/slots";
import { runAssessment, type AssessmentResult } from "@/agents/assessment";
import {
  runScheduling,
  searchWindow,
  type SchedulingRequest,
  type SchedulingResult,
} from "@/agents/scheduling";
import {
  runRecovery,
  runWaitlistFill,
  type RecoveryItemInput,
  type RecoveryResult,
  type WaitlistFillResult,
} from "@/agents/recovery";
import {
  bannedContentLint,
  runCommsDraft,
  type CommsDraftResult,
  type DraftItem,
  type DraftPurpose,
} from "@/agents/comms";
import { getDoctor, getPatient, patientHistory } from "@/agents/tools";
import type { Slot } from "@/core/types";

const pace = () => sleep(env().PACING_MS);

type Meta = Record<string, any>;
const meta = (caseId: string): Meta => (getCase(caseId).meta as Meta) ?? {};

// ---------------------------------------------------------------------------
// Step: assessment (doctor emergency)
// ---------------------------------------------------------------------------

export async function assessStep(caseId: string): Promise<string> {
  const m = meta(caseId);
  const c = getCase(caseId);
  if (c.state === "open")
    transitionCase(caseId, "assessing", "orchestrator", "Assessment starting");
  const doctor = getDoctor(m.doctorId);
  await pace();
  const res = await runAssessment(
    {
      caseId,
      doctorId: m.doctorId,
      doctorName: doctor.name,
      date: m.date,
      reason: m.reason ?? "emergency",
    },
    { caseId },
  );
  const a: AssessmentResult = res.output;
  db.update(schema.cases)
    .set({ severity: a.severity })
    .where(eq(schema.cases.id, caseId))
    .run();
  updateCaseMeta(caseId, { assessment: a });
  timeline(
    caseId,
    "assessment",
    "status",
    `${a.items.length} appointment${a.items.length === 1 ? "" : "s"} affected — severity ${a.severity}`,
    a.summary,
    { severity: a.severity, mode: res.mode },
  );
  if (getCase(caseId).state === "assessing")
    transitionCase(
      caseId,
      "planning",
      "orchestrator",
      "Assessment complete — planning recovery",
    );
  await pace();
  return a.summary;
}

// ---------------------------------------------------------------------------
// Step: scheduling search (all affected, or a single replan item)
// ---------------------------------------------------------------------------

export async function scheduleStep(
  caseId: string,
  constraints?: {
    appointmentId?: string;
    afterTime?: string;
    beforeTime?: string;
    dayPart?: "am" | "pm";
    preferredDay?: string;
  },
): Promise<string> {
  const m = meta(caseId);
  const assessment: AssessmentResult | undefined = m.assessment;
  const items = (assessment?.items ?? []).filter(
    (it: any) =>
      !constraints?.appointmentId ||
      it.appointmentId === constraints.appointmentId,
  );
  if (items.length === 0)
    throw new Error("scheduleStep: no assessed items to search for");

  const win = constraints?.preferredDay
    ? {
        fromDay: constraints.preferredDay,
        toDay: searchWindow(constraints.preferredDay, 4).toDay,
      }
    : searchWindow(demoToday(), 8);
  const requests: SchedulingRequest[] = items.map((it: any) => ({
    appointmentId: it.appointmentId,
    patientId: it.patientId,
    type: it.type,
    originalDoctorId:
      m.doctorId ?? it.originalDoctorId ?? getAppt(it.appointmentId).doctorId,
    originalStartUtc: it.startUtc,
    searchFromDay: win.fromDay,
    searchToDay: win.toDay,
    afterTime: constraints?.afterTime,
    dayPart: constraints?.dayPart,
  }));

  const res = await runScheduling({ caseId, requests }, { caseId });
  const out: SchedulingResult = res.output;

  // Hard gate: every option must survive the deterministic validator right now.
  let dropped = 0;
  const validated: Record<string, Slot[]> = {};
  for (const per of out.perAppointment) {
    const req = requests.find((r) => r.appointmentId === per.appointmentId);
    const keep: Slot[] = [];
    for (const opt of per.options) {
      const v = await validatePlacementNow({
        doctorId: opt.doctorId,
        type: (req?.type ?? "routine") as any,
        startUtc: opt.startUtc,
        ignoreAppointmentId: per.appointmentId,
      });
      if (v.ok) keep.push(opt);
      else dropped += 1;
    }
    validated[per.appointmentId] = keep;
  }
  if (dropped > 0)
    timeline(
      caseId,
      "scheduling",
      "error",
      `${dropped} proposed option${dropped === 1 ? "" : "s"} failed re-validation and were dropped`,
      "Options must pass the deterministic placement validator; agents cannot override it.",
    );
  updateCaseMeta(caseId, {
    slotOptions: validated,
    searchSummary: out.searchSummary,
    searchConstraints: constraints ?? null,
  });
  timeline(
    caseId,
    "scheduling",
    "status",
    "Valid slot options collected",
    out.searchSummary,
    { mode: res.mode },
  );
  await pace();
  return out.searchSummary;
}

function getAppt(id: string) {
  const a = db
    .select()
    .from(schema.appointments)
    .where(eq(schema.appointments.id, id))
    .get();
  if (!a) throw new Error(`appointment ${id} not found`);
  return a;
}

// ---------------------------------------------------------------------------
// Step: recovery ranking
// ---------------------------------------------------------------------------

/**
 * Deterministic guard after recovery planning (applies to live AND fallback
 * output): each patient's search runs independently, so two plans can pick the
 * same (doctor, start) slot. Walk plans in priority order; if a chosen slot is
 * already claimed by a higher-priority patient, shift to that plan's first
 * unclaimed option. Then prune every plan's alternates of slots chosen for
 * OTHER patients, so staff "Modify" choices can't silently collide either.
 * The executor still re-validates every placement — this pass just makes the
 * happy path actually happy.
 */
function dedupeChosenAcrossPatients(
  r: RecoveryResult,
  items: RecoveryItemInput[],
  caseId: string,
): void {
  const priority = new Map(
    items.map((it) => [it.appointmentId, it.priorityRank]),
  );
  const nameOf = new Map(items.map((it) => [it.appointmentId, it.patientName]));
  const ordered = [...r.plans].sort(
    (a, b) =>
      (priority.get(a.appointmentId) ?? 99) -
      (priority.get(b.appointmentId) ?? 99),
  );
  const keyOf = (o: { doctorId: string; startUtc: string }) =>
    `${o.doctorId}|${o.startUtc}`;
  const claimed = new Map<string, string>(); // slot key → appointmentId that owns it

  for (const plan of ordered) {
    if (plan.chosenOptionId === "none" || plan.options.length === 0) continue;
    const chosen =
      plan.options.find((o) => o.id === plan.chosenOptionId) ?? plan.options[0];
    if (claimed.has(keyOf(chosen))) {
      const alt = plan.options.find((o) => !claimed.has(keyOf(o)));
      if (alt) {
        plan.chosenOptionId = alt.id;
        const holder =
          nameOf.get(claimed.get(keyOf(chosen))!) ?? "another patient";
        plan.reorderReason = [
          plan.reorderReason,
          `Top slot shifted to avoid double-booking with ${holder}.`,
        ]
          .filter(Boolean)
          .join(" ")
          .slice(0, 200);
        timeline(
          caseId,
          "recovery",
          "status",
          `${nameOf.get(plan.appointmentId) ?? plan.appointmentId}: shifted to the next open option to avoid a double-booking`,
        );
        claimed.set(keyOf(alt), plan.appointmentId);
      } else {
        plan.chosenOptionId = "none";
        plan.options = [];
        plan.rationale =
          `${plan.rationale} All ranked options were claimed by higher-priority patients; escalating to staff.`.slice(
            0,
            400,
          );
      }
    } else {
      claimed.set(keyOf(chosen), plan.appointmentId);
    }
  }
  // Remove alternates now owned by someone else (keep each plan's own chosen).
  for (const plan of ordered) {
    plan.options = plan.options.filter((o) => {
      const owner = claimed.get(keyOf(o));
      return !owner || owner === plan.appointmentId;
    });
  }
}

export async function recoverStep(
  caseId: string,
  onlyAppointmentId?: string,
): Promise<string> {
  const m = meta(caseId);
  const assessment: AssessmentResult | undefined = m.assessment;
  const slotOptions: Record<string, Slot[]> = m.slotOptions ?? {};
  const items: RecoveryItemInput[] = (assessment?.items ?? [])
    .filter(
      (it: any) => !onlyAppointmentId || it.appointmentId === onlyAppointmentId,
    )
    .map((it: any) => ({
      appointmentId: it.appointmentId,
      patientId: it.patientId,
      patientName: it.patientName,
      type: it.type,
      originalDoctorId: m.doctorId ?? getAppt(it.appointmentId).doctorId,
      originalStartUtc: it.startUtc,
      options: slotOptions[it.appointmentId] ?? [],
      priorityRank: it.priorityRank,
      priorityReason: it.priorityReason,
    }));
  if (items.length === 0) throw new Error("recoverStep: nothing to plan");
  const res = await runRecovery({ caseId, items }, { caseId });
  const r: RecoveryResult = res.output;
  dedupeChosenAcrossPatients(r, items, caseId);
  updateCaseMeta(caseId, { plans: r.plans, planSummary: r.summary });
  timeline(
    caseId,
    "recovery",
    "status",
    `Recovery plans ranked for ${r.plans.length} patient${r.plans.length === 1 ? "" : "s"}`,
    r.summary,
    { mode: res.mode },
  );
  await pace();
  return r.summary;
}

// ---------------------------------------------------------------------------
// Step: communications drafting + recommendation creation
// ---------------------------------------------------------------------------

export async function commsStep(
  caseId: string,
  opts?: { replanOf?: string; replanNote?: string; onlyAppointmentId?: string },
): Promise<string> {
  const m = meta(caseId);
  const assessment: AssessmentResult | undefined = m.assessment;
  const plans = (m.plans ?? []).filter(
    (p: any) =>
      !opts?.onlyAppointmentId || p.appointmentId === opts.onlyAppointmentId,
  );
  if (plans.length === 0) throw new Error("commsStep: no plans to draft for");

  const items: DraftItem[] = [];
  for (const plan of plans) {
    const it = (assessment?.items ?? []).find(
      (x: any) => x.appointmentId === plan.appointmentId,
    );
    if (!it) continue;
    const chosen =
      plan.options.find((o: any) => o.id === plan.chosenOptionId) ??
      plan.options[0];
    if (!chosen) continue;
    const origDoctor = getDoctor(
      m.doctorId ?? getAppt(plan.appointmentId).doctorId,
    );
    items.push({
      patientId: it.patientId,
      patientName: it.patientName,
      appointmentId: plan.appointmentId,
      context: {
        doctorName: origDoctor.name,
        originalWhen: fmtWhen(it.startUtc),
        proposedWhen: fmtWhen(chosen.startUtc),
        proposedDoctorName: chosen.doctorName,
        reason: opts?.replanOf ? "counter" : m.reason,
        extraNote: opts?.replanNote ?? undefined,
      },
    });
  }
  const res = await runCommsDraft(
    { caseId, purpose: "reschedule_offer", items },
    { caseId },
  );
  const linted = bannedContentLint(
    "reschedule_offer",
    items,
    res.output as CommsDraftResult,
  );
  for (const w of linted.warnings)
    timeline(caseId, "comms", "error", "Draft replaced by safe template", w);

  let created = 0;
  for (const plan of plans) {
    if (!plan.options.length || plan.chosenOptionId === "none") {
      timeline(
        caseId,
        "recovery",
        "escalation",
        `No valid options for appointment ${plan.appointmentId} — staff attention needed`,
        plan.rationale,
      );
      continue;
    }
    const it = (assessment?.items ?? []).find(
      (x: any) => x.appointmentId === plan.appointmentId,
    );
    const draft = linted.result.drafts.find(
      (d) => d.appointmentId === plan.appointmentId,
    );
    const appt = getAppt(plan.appointmentId);
    db.insert(schema.recommendations)
      .values({
        caseId,
        appointmentId: plan.appointmentId,
        patientId: it?.patientId ?? null,
        kind: "reschedule",
        status: "proposed",
        outcome: "pending",
        payload: {
          appointmentId: plan.appointmentId,
          patientId: it?.patientId,
          patientName: it?.patientName,
          type: it?.type,
          priorityRank: it?.priorityRank,
          priorityReason: it?.priorityReason,
          tags: it?.tags ?? [],
          from: {
            doctorId: appt.doctorId,
            doctorName: getDoctor(appt.doctorId).name,
            startUtc: appt.startUtc,
            when: fmtWhen(appt.startUtc),
          },
          chosenOptionId: plan.chosenOptionId,
          options: plan.options,
          rationale: plan.rationale,
          reorderReason: plan.reorderReason,
          draft: draft ? { subject: draft.subject, body: draft.body } : null,
          replanOf: opts?.replanOf ?? null,
          replanNote: opts?.replanNote ?? null,
        },
        createdAt: new Date().toISOString(),
      })
      .run();
    created += 1;
    timeline(
      caseId,
      "comms",
      "recommendation",
      `Offer ready for ${it?.patientName}`,
      draft ? draft.subject : undefined,
      { appointmentId: plan.appointmentId },
    );
  }
  if (opts?.replanOf) {
    db.update(schema.recommendations)
      .set({ outcome: "superseded" })
      .where(eq(schema.recommendations.id, opts.replanOf))
      .run();
  }
  const c = getCase(caseId);
  if (c.state === "planning")
    transitionCase(
      caseId,
      "awaiting_approval",
      "orchestrator",
      `${created} recommendation${created === 1 ? "" : "s"} ready — nothing is sent or written until staff approve.`,
    );
  await pace();
  return `${created} recommendation(s) awaiting staff approval`;
}

// ---------------------------------------------------------------------------
// Step: simple-draft cases (confirmation nudge / preventive outreach)
// ---------------------------------------------------------------------------

export async function nudgeStep(
  caseId: string,
  purpose: Extract<DraftPurpose, "confirm_nudge" | "preventive">,
): Promise<string> {
  const m = meta(caseId);
  const c = getCase(caseId);
  if (c.state === "open")
    transitionCase(
      caseId,
      "assessing",
      "orchestrator",
      "Reviewing appointment context",
    );
  const appt = getAppt(m.appointmentId);
  const patient = getPatient(appt.patientId);
  const doctor = getDoctor(appt.doctorId);
  if (getCase(caseId).state === "assessing")
    transitionCase(caseId, "planning", "orchestrator", "Drafting outreach");
  await pace();
  const items: DraftItem[] = [
    {
      patientId: patient.id,
      patientName: patient.name,
      appointmentId: appt.id,
      context: {
        doctorName: doctor.name,
        originalWhen: fmtWhen(appt.startUtc),
      },
    },
  ];
  const res = await runCommsDraft({ caseId, purpose, items }, { caseId });
  const linted = bannedContentLint(
    purpose,
    items,
    res.output as CommsDraftResult,
  );
  for (const w of linted.warnings)
    timeline(caseId, "comms", "error", "Draft replaced by safe template", w);
  const draft = linted.result.drafts[0];
  db.insert(schema.recommendations)
    .values({
      caseId,
      appointmentId: appt.id,
      patientId: patient.id,
      kind: purpose === "confirm_nudge" ? "confirm_nudge" : "preventive",
      status: "proposed",
      outcome: "pending",
      payload: {
        appointmentId: appt.id,
        patientId: patient.id,
        patientName: patient.name,
        type: appt.type,
        from: {
          doctorId: doctor.id,
          doctorName: doctor.name,
          startUtc: appt.startUtc,
          when: fmtWhen(appt.startUtc),
        },
        riskFlag: m.flag ?? null,
        rationale:
          purpose === "confirm_nudge"
            ? `${patient.name} hasn't confirmed the ${fmtWhen(appt.startUtc)} visit yet; a gentle nudge protects the slot.`
            : (m.flag?.explanation ??
              `${patient.name} shows elevated no-show risk; early outreach protects the slot.`),
        draft: { subject: draft.subject, body: draft.body },
      },
      createdAt: new Date().toISOString(),
    })
    .run();
  timeline(
    caseId,
    "comms",
    "recommendation",
    `${purpose === "confirm_nudge" ? "Confirmation nudge" : "Preventive outreach"} drafted for ${patient.name}`,
    draft.subject,
  );
  transitionCase(
    caseId,
    "awaiting_approval",
    "orchestrator",
    "Draft ready — awaiting staff approval.",
  );
  await pace();
  return `1 ${purpose} recommendation awaiting approval`;
}

// ---------------------------------------------------------------------------
// Step: waitlist backfill for a vacated slot
// ---------------------------------------------------------------------------

export async function waitlistStep(caseId: string): Promise<string> {
  const m = meta(caseId);
  const c = getCase(caseId);
  if (c.state === "open")
    transitionCase(
      caseId,
      "assessing",
      "orchestrator",
      "Reviewing the vacated slot",
    );
  const appt = getAppt(m.appointmentId); // the cancelled appointment
  const doctor = getDoctor(appt.doctorId);
  const slot: Slot = {
    doctorId: appt.doctorId,
    startUtc: appt.startUtc,
    endUtc: appt.endUtc,
    day: m.day ?? localDayOf(appt.startUtc),
    block: m.block ?? blockOf(appt.startUtc),
  };
  if (getCase(caseId).state === "assessing")
    transitionCase(
      caseId,
      "planning",
      "orchestrator",
      "Ranking waitlist candidates",
    );
  await pace();

  const wl = db
    .select()
    .from(schema.waitlist)
    .where(eq(schema.waitlist.status, "waiting"))
    .all();
  const candidates = wl.map((w) => {
    const p = getPatient(w.patientId);
    return {
      waitlistId: w.id,
      patientId: w.patientId,
      patientName: p.name,
      type: w.type,
      dayPart: w.dayPart as any,
      addedAt: w.addedAt,
      staffPriority: w.staffPriority,
      preferredDoctorId: w.doctorId,
      history: patientHistory(w.patientId),
    };
  });
  const res = await runWaitlistFill(
    {
      caseId,
      slot,
      slotType: appt.type as any,
      vacatedAppointmentId: appt.id,
      candidates,
    },
    { caseId },
  );
  const fill: WaitlistFillResult = res.output;
  updateCaseMeta(caseId, { fill });
  if (fill.chosenWaitlistId === "none" || fill.candidates.length === 0) {
    timeline(
      caseId,
      "recovery",
      "escalation",
      "No waitlist match for the vacated slot",
      fill.rationale,
    );
    transitionCase(
      caseId,
      "awaiting_approval",
      "orchestrator",
      "No candidate found — staff may close or handle manually.",
    );
    return "no waitlist candidates";
  }
  const chosen = fill.candidates.find((x) => x.rank === 1)!;
  const chosenPatient = getPatient(chosen.patientId);
  const items: DraftItem[] = [
    {
      patientId: chosen.patientId,
      patientName: chosen.patientName,
      context: {
        proposedWhen: fmtWhen(slot.startUtc),
        proposedDoctorName: doctor.name,
      },
    },
  ];
  const dres = await runCommsDraft(
    { caseId, purpose: "waitlist_offer", items },
    { caseId },
  );
  const linted = bannedContentLint(
    "waitlist_offer",
    items,
    dres.output as CommsDraftResult,
  );
  for (const w of linted.warnings)
    timeline(caseId, "comms", "error", "Draft replaced by safe template", w);
  const draft = linted.result.drafts[0];
  db.insert(schema.recommendations)
    .values({
      caseId,
      appointmentId: appt.id,
      patientId: chosen.patientId,
      kind: "waitlist_fill",
      status: "proposed",
      outcome: "pending",
      payload: {
        vacatedAppointmentId: appt.id,
        slot,
        slotType: appt.type,
        doctorName: doctor.name,
        when: fmtWhen(slot.startUtc),
        chosenWaitlistId: fill.chosenWaitlistId,
        patientId: chosen.patientId,
        patientName: chosen.patientName,
        candidates: fill.candidates,
        rationale: fill.rationale,
        draft: { subject: draft.subject, body: draft.body },
      },
      createdAt: new Date().toISOString(),
    })
    .run();
  timeline(
    caseId,
    "comms",
    "recommendation",
    `Waitlist offer ready for ${chosenPatient.name}`,
    draft.subject,
  );
  transitionCase(
    caseId,
    "awaiting_approval",
    "orchestrator",
    "Backfill offer ready — awaiting staff approval.",
  );
  await pace();
  return `waitlist offer for ${chosenPatient.name} awaiting approval`;
}

// ---------------------------------------------------------------------------
// Replan entry (used by the reply handler for counter-proposals). Sequencing
// of the full pipeline lives in graph/caseGraph.ts.
// ---------------------------------------------------------------------------

/**
 * Constraint-driven replan for one appointment, fed by a staff-approved
 * SchedulingConstraintSet from the constraint editor. Mirrors replanSingle,
 * but the slot search is findSlotsForConstraints (hard filter + soft
 * ranking) instead of the legacy four-field search. Every kept slot still
 * passes validatePlacementNow, and the result flows through the SAME
 * recovery ranking + comms drafting + staff approval gate as everything
 * else — the constraint set only ever narrows what the engine validated.
 */
export async function replanWithConstraintSet(
  caseId: string,
  args: {
    appointmentId: string;
    supersededRecId: string;
    set: SchedulingConstraintSet;
    note: string;
    /** Optional staff-chosen slot from the editor's search results. */
    chosenSlot?: { doctorId: string; startUtc: string };
  },
): Promise<string> {
  const c = getCase(caseId);
  // A staff-approved constraint replan legitimately reactivates the case:
  // from resolving (counter-proposal loop) or from escalated (staff is
  // handling the escalation through the constraint editor).
  if (c.state === "resolving" || c.state === "escalated")
    transitionCase(
      caseId,
      "planning",
      "staff",
      `Replanning one patient — ${args.note}`,
    );
  audit({
    actor: "staff",
    action: "case.constraint_replan",
    caseId,
    refType: "recommendation",
    refId: args.supersededRecId,
    detail: { set: args.set, chosenSlot: args.chosenSlot ?? null },
  });

  const m = meta(caseId);
  const items = (m.assessment?.items ?? []) as any[];
  let appointmentId = args.appointmentId;
  let item = items.find((it) => it.appointmentId === appointmentId);
  if (!item) {
    // The caller may have passed the offer's created HOLD id instead of the
    // original appointment id (assessment is keyed by originals). Resolve via
    // the superseded recommendation's payload.
    const rec = db
      .select()
      .from(schema.recommendations)
      .where(eq(schema.recommendations.id, args.supersededRecId))
      .get();
    const original = (rec?.payload as any)?.appointmentId;
    if (original) {
      item = items.find((it) => it.appointmentId === original);
      if (item) appointmentId = original;
    }
  }
  if (!item)
    throw new Error(
      `replanWithConstraintSet: appointment ${args.appointmentId} is not in this case's assessment`,
    );
  const originalDoctorId = m.doctorId ?? getAppt(appointmentId).doctorId;

  const scored = await findSlotsForConstraints({
    set: args.set,
    type: item.type,
    ignoreAppointmentId: appointmentId,
    originalDoctorId,
    horizonDays: 14,
  });
  let candidates = scored.map((s) => s.slot);
  if (args.chosenSlot) {
    candidates = candidates.filter(
      (s) =>
        s.doctorId === args.chosenSlot!.doctorId &&
        s.startUtc === args.chosenSlot!.startUtc,
    );
    if (candidates.length === 0)
      throw new Error(
        "replanWithConstraintSet: the chosen slot no longer satisfies the constraints or is taken",
      );
  }

  // Hard gate, same as scheduleStep: every option must pass the deterministic
  // placement validator right now.
  const keep: Slot[] = [];
  for (const slot of candidates.slice(0, 8)) {
    const v = await validatePlacementNow({
      doctorId: slot.doctorId,
      type: item.type,
      startUtc: slot.startUtc,
      ignoreAppointmentId: appointmentId,
    });
    if (v.ok) keep.push(slot);
    if (keep.length >= 6) break;
  }

  updateCaseMeta(caseId, {
    slotOptions: { ...(m.slotOptions ?? {}), [appointmentId]: keep },
    searchSummary: `Constraint search: ${keep.length} valid option${keep.length === 1 ? "" : "s"} (${describeConstraintSet(args.set)})`,
    searchConstraints: { constraintSet: args.set },
  });
  timeline(
    caseId,
    "scheduling",
    keep.length === 0 ? "error" : "status",
    keep.length === 0
      ? "No slots satisfy the approved constraints — staff follow-up needed"
      : `Constraint search found ${keep.length} valid option${keep.length === 1 ? "" : "s"}`,
    args.set.summary,
    { appointmentId },
  );

  // Negotiation bookkeeping: every constraint-driven offer is a round, and
  // the offered slot is recorded so later declines carry history.
  if (keep.length > 0) {
    const nego = getOrCreateNegotiation({
      caseId,
      appointmentId,
      patientId: item.patientId,
      constraintSet: args.set,
    });
    const doctorName = db
      .select()
      .from(schema.doctors)
      .where(eq(schema.doctors.id, keep[0].doctorId))
      .get()?.name;
    recordOfferedSlot(nego, {
      doctorId: keep[0].doctorId,
      startUtc: keep[0].startUtc,
      label: `${fmtWhen(keep[0].startUtc)} · ${doctorName ?? keep[0].doctorId}`,
    });
    updateNegotiation(nego.id, {
      constraintSet: args.set,
      turn: nego.turn + 1,
      lastAction: "offer_slots",
    });
  }

  await recoverStep(caseId, appointmentId);
  return commsStep(caseId, {
    replanOf: args.supersededRecId,
    replanNote: args.note,
    onlyAppointmentId: appointmentId,
  });
}

export async function replanSingle(
  caseId: string,
  args: {
    appointmentId: string;
    supersededRecId: string;
    constraint: {
      afterTime?: string;
      beforeTime?: string;
      dayPart?: "am" | "pm";
      preferredDay?: string;
    };
    note: string;
  },
): Promise<string> {
  const c = getCase(caseId);
  if (c.state === "resolving")
    transitionCase(
      caseId,
      "planning",
      "orchestrator",
      `Replanning one patient — ${args.note}`,
    );
  audit({
    actor: "orchestrator",
    action: "case.replan",
    caseId,
    refType: "recommendation",
    refId: args.supersededRecId,
    detail: args.constraint,
  });
  await scheduleStep(caseId, {
    appointmentId: args.appointmentId,
    ...args.constraint,
  });
  await recoverStep(caseId, args.appointmentId);
  return commsStep(caseId, {
    replanOf: args.supersededRecId,
    replanNote: args.note,
    onlyAppointmentId: args.appointmentId,
  });
}
