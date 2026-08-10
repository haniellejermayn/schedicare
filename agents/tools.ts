/**
 * Shared read-only tools. This is the entire surface agents can touch:
 * queries and pure scorers. There is no write tool here by design — external
 * effects live exclusively behind the staff approval gate (worker/executor).
 */
import { z } from "zod";
import { and, desc, eq, gt, gte, inArray, lt } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { demoNow, demoToday, fmtWhen } from "@/core/clock";
import {
  findOpenSlots,
  dayLoad,
  RESCHEDULE_MIN_NOTICE_MINUTES,
} from "@/core/scheduling";
import { getRules } from "@/core/rules";
import { scoreNoShowRisk } from "@/core/risk";
import { addDays, format } from "date-fns";
import type { ToolDef } from "./runtime/types";
import { APPOINTMENT_TYPES } from "@/core/types";

export function getDoctor(doctorId: string) {
  const d = db.select().from(schema.doctors).where(eq(schema.doctors.id, doctorId)).get();
  if (!d) throw new Error(`doctor ${doctorId} not found`);
  return d;
}

export function getPatient(patientId: string) {
  const p = db.select().from(schema.patients).where(eq(schema.patients.id, patientId)).get();
  if (!p) throw new Error(`patient ${patientId} not found`);
  return p;
}

export function patientHistory(patientId: string) {
  return db
    .select()
    .from(schema.attendanceHistory)
    .where(eq(schema.attendanceHistory.patientId, patientId))
    .all();
}

export function affectedAppointments(doctorId: string, dateLocal: string) {
  const rows = db
    .select()
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.doctorId, doctorId),
        inArray(schema.appointments.status, ["booked", "confirmed"]),
        gt(schema.appointments.startUtc, demoNow().toISOString())
      )
    )
    .all()
    .filter((a) => a.startUtc >= "" && dateOfLocal(a.startUtc) === dateLocal)
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  return rows;
}

import { formatInTimeZone } from "date-fns-tz";
import { CLINIC_TZ } from "@/core/env";
function dateOfLocal(utc: string): string {
  return formatInTimeZone(new Date(utc), CLINIC_TZ, "yyyy-MM-dd");
}

export const toolGetDoctors: ToolDef = {
  name: "get_doctors",
  description: "List the clinic's doctors with specialty, status, and a one-line rules summary.",
  schema: z.object({}),
  run: async () => {
    const rows = db.select().from(schema.doctors).all();
    return rows.map((d) => {
      const r = getRules(d.id);
      return {
        doctorId: d.id,
        name: d.name,
        specialty: d.specialty,
        status: d.status,
        unavailableDates: d.unavailableDates,
        rulesSummary: `windows ${JSON.stringify(r.windows)}, buffer ${r.bufferAfterMin}m, max/day ${r.maxPerDay}, max/block am ${r.maxPerBlock.am} pm ${r.maxPerBlock.pm}`,
      };
    });
  },
};

export const toolGetDoctorRules: ToolDef = {
  name: "get_doctor_rules",
  description: "Read a doctor's full scheduling rule set (windows per type, buffers, daily and block caps).",
  schema: z.object({ doctorId: z.string() }),
  run: async ({ doctorId }) => getRules(doctorId),
};

export const toolFindOpenSlots: ToolDef = {
  name: "find_open_slots",
  description:
    "Deterministically list valid open slots for a doctor/type/date-range. Every slot returned is guaranteed conflict-free, rule-compliant, buffer-respecting, and under capacity. You may ONLY propose times that appear verbatim in these results.",
  schema: z.object({
    doctorId: z.string(),
    type: z.enum(APPOINTMENT_TYPES),
    fromDay: z.string().describe("clinic-local yyyy-MM-dd"),
    toDay: z.string().describe("clinic-local yyyy-MM-dd"),
    afterTime: z.string().optional().describe("HH:mm clinic-local lower bound"),
    dayPart: z.enum(["am", "pm"]).optional(),
    ignoreAppointmentId: z.string().optional().describe("exclude this appointment from conflicts when rescheduling it"),
  }),
  run: async (i) => {
    const slots = await findOpenSlots({
      ...i,
      minimumNoticeMinutes: RESCHEDULE_MIN_NOTICE_MINUTES,
      limit: 24,
    });
    return slots.map((s) => ({ ...s, when: fmtWhen(s.startUtc) }));
  },
};

export const toolGetDayLoad: ToolDef = {
  name: "get_day_load",
  description: "Fraction (0..1) of a doctor's daily capacity already booked on a clinic-local day.",
  schema: z.object({ doctorId: z.string(), day: z.string() }),
  run: async ({ doctorId, day }) => ({ doctorId, day, load: Number(dayLoad(doctorId, day).toFixed(2)) }),
};

export const toolGetAffected: ToolDef = {
  name: "get_affected_appointments",
  description: "All still-upcoming active appointments for a doctor on a clinic-local date, with patient context.",
  schema: z.object({ doctorId: z.string(), date: z.string() }),
  run: async ({ doctorId, date }) => {
    return affectedAppointments(doctorId, date).map((a) => {
      const p = getPatient(a.patientId);
      const hist = patientHistory(a.patientId);
      return {
        appointmentId: a.id,
        patientId: a.patientId,
        patientName: p.name,
        type: a.type,
        startUtc: a.startUtc,
        when: fmtWhen(a.startUtc),
        status: a.status,
        prefDayPart: p.prefDayPart,
        notes: p.notes,
        noShows: hist.filter((h) => h.kind === "no_show").length,
      };
    });
  },
};

export const toolGetPatientHistory: ToolDef = {
  name: "get_patient_history",
  description: "A patient's attendance history (attended / no_show / late_cancel / cancelled_ok).",
  schema: z.object({ patientId: z.string() }),
  run: async ({ patientId }) => patientHistory(patientId),
};

export const toolListUpcoming: ToolDef = {
  name: "list_upcoming",
  description: "Active appointments in the next N days across the clinic.",
  schema: z.object({ days: z.number().int().min(1).max(30) }),
  run: async ({ days }) => {
    const now = demoNow().toISOString();
    const until = addDays(demoNow(), days).toISOString();
    const rows = db
      .select()
      .from(schema.appointments)
      .where(
        and(
          inArray(schema.appointments.status, ["booked", "confirmed"]),
          gte(schema.appointments.startUtc, now),
          lt(schema.appointments.startUtc, until)
        )
      )
      .all()
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    return rows.map((a) => ({
      appointmentId: a.id,
      patientId: a.patientId,
      doctorId: a.doctorId,
      type: a.type,
      startUtc: a.startUtc,
      when: fmtWhen(a.startUtc),
      status: a.status,
      bookedAt: a.bookedAt,
    }));
  },
};

export const toolScoreNoShow: ToolDef = {
  name: "score_no_show",
  description:
    "Deterministic, explainable no-show risk score (0-100) for an appointment. Returns the factor breakdown; you explain it, you never recompute it.",
  schema: z.object({ appointmentId: z.string() }),
  run: async ({ appointmentId }) => {
    const a = db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).get();
    if (!a) throw new Error(`appointment ${appointmentId} not found`);
    const hist = patientHistory(a.patientId);
    const r = scoreNoShowRisk({ status: a.status, startUtc: a.startUtc, bookedAt: a.bookedAt, now: demoNow(), history: hist });
    return { appointmentId, ...r };
  },
};

export const toolGetWaitlist: ToolDef = {
  name: "get_waitlist",
  description: "Current waiting waitlist entries, optionally filtered by appointment type.",
  schema: z.object({ type: z.enum(APPOINTMENT_TYPES).optional() }),
  run: async ({ type }) => {
    const rows = db.select().from(schema.waitlist).where(eq(schema.waitlist.status, "waiting")).all();
    return rows
      .filter((w) => !type || w.type === type)
      .map((w) => {
        const p = getPatient(w.patientId);
        return {
          waitlistId: w.id,
          patientId: w.patientId,
          patientName: p.name,
          type: w.type,
          dayPart: w.dayPart,
          addedAt: w.addedAt,
          preferredDoctorId: w.doctorId,
        };
      });
  },
};

export const toolToday: ToolDef = {
  name: "get_clinic_today",
  description: "Today's clinic-local date and current time (the demo clock).",
  schema: z.object({}),
  quiet: true,
  run: async () => ({ today: demoToday(), nowUtc: demoNow().toISOString(), nowLocal: fmtWhen(demoNow()), timezone: CLINIC_TZ }),
};

export function upcomingForRisk(days: number) {
  const now = demoNow().toISOString();
  const until = addDays(demoNow(), days).toISOString();
  return db
    .select()
    .from(schema.appointments)
    .where(
      and(
        inArray(schema.appointments.status, ["booked", "confirmed"]),
        gte(schema.appointments.startUtc, now),
        lt(schema.appointments.startUtc, until)
      )
    )
    .all()
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export function recentCancellationsWithFutureSlot(withinDays = 2) {
  const cutoff = addDays(demoNow(), -withinDays).toISOString();
  return db
    .select()
    .from(schema.appointments)
    .where(
      and(
        inArray(schema.appointments.status, ["cancelled_by_patient"]),
        gt(schema.appointments.startUtc, demoNow().toISOString()),
        gt(schema.appointments.createdAt, "")
      )
    )
    .all()
    .filter((a) => (a.bookedAt ?? "") >= "" && a.startUtc > demoNow().toISOString())
    .filter((a) => a.createdAt >= cutoff || true);
}

export function nextDays(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(format(addDays(new Date(`${demoToday()}T00:00:00Z`), i), "yyyy-MM-dd"));
  return out;
}
