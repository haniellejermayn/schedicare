import { z } from "zod";
import { addDays, format } from "date-fns";
import { runAgent } from "./runtime";
import type { AgentCtx, AgentDef } from "./runtime/types";
import {
  toolFindOpenSlots,
  toolGetDayLoad,
  toolGetDoctorRules,
  toolGetDoctors,
  toolToday,
} from "./tools";
import {
  findOpenSlots,
  RESCHEDULE_MIN_NOTICE_MINUTES,
} from "@/core/scheduling";
import { db, schema } from "@/core/db/client";
import { SlotSchema, APPOINTMENT_TYPES, type Slot } from "@/core/types";

export const SchedulingRequestSchema = z.object({
  appointmentId: z.string(),
  patientId: z.string(),
  type: z.enum(APPOINTMENT_TYPES),
  originalDoctorId: z.string(),
  originalStartUtc: z.string(),
  searchFromDay: z.string(),
  searchToDay: z.string(),
  afterTime: z.string().optional(),
  dayPart: z.enum(["am", "pm"]).optional(),
});
export type SchedulingRequest = z.infer<typeof SchedulingRequestSchema>;

export const SchedulingResultSchema = z.object({
  perAppointment: z
    .array(
      z.object({
        appointmentId: z.string(),
        options: z.array(SlotSchema).max(12),
        note: z.string().max(350).optional(),
      }),
    )
    .max(30),
  searchSummary: z.string().max(700),
});
export type SchedulingResult = z.infer<typeof SchedulingResultSchema>;

export interface SchedulingInput {
  caseId: string;
  requests: SchedulingRequest[];
}

/**
 * Deterministic search strategy shared with the live prompt: try the original
 * doctor first across the window (their emergency date is already excluded by
 * the engine via unavailableDates), then other doctors starting same-day.
 * Cap at 8 options per appointment, mixed across doctors.
 */
async function deterministicSearch(
  input: SchedulingInput,
): Promise<SchedulingResult> {
  const doctors = db.select().from(schema.doctors).all();
  const perAppointment: SchedulingResult["perAppointment"] = [];
  for (const req of input.requests) {
    const options: Slot[] = [];
    const same = await findOpenSlots({
      doctorId: req.originalDoctorId,
      type: req.type,
      fromDay: req.searchFromDay,
      toDay: req.searchToDay,
      afterTime: req.afterTime,
      dayPart: req.dayPart,
      ignoreAppointmentId: req.appointmentId,
      minimumNoticeMinutes: RESCHEDULE_MIN_NOTICE_MINUTES,
      limit: 60,
    });
    options.push(...spread(same, 5));
    for (const d of doctors) {
      if (d.id === req.originalDoctorId) continue;
      const other = await findOpenSlots({
        doctorId: d.id,
        type: req.type,
        fromDay: req.searchFromDay,
        toDay: req.searchToDay,
        afterTime: req.afterTime,
        dayPart: req.dayPart,
        minimumNoticeMinutes: RESCHEDULE_MIN_NOTICE_MINUTES,
        limit: 60,
      });
      options.push(...spread(other, 4));
    }
    options.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
    perAppointment.push({
      appointmentId: req.appointmentId,
      options: dedupe(options).slice(0, 8),
      note:
        same.length === 0
          ? "No same-doctor slots in the window; cross-doctor options offered."
          : undefined,
    });
  }
  const total = perAppointment.reduce((s, p) => s + p.options.length, 0);
  return {
    perAppointment,
    searchSummary: `Searched ${input.requests.length} appointment${input.requests.length === 1 ? "" : "s"} across ${doctors.length} doctors, ${input.requests[0]?.searchFromDay ?? ""}–${input.requests[0]?.searchToDay ?? ""}; ${total} rule-valid options found (same-doctor first, then cross-doctor).`,
  };
}

/** Take at most n slots spread across distinct days (soonest-first within a day). */
function spread(slots: Slot[], n: number): Slot[] {
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) {
    if (!byDay.has(s.day)) byDay.set(s.day, []);
    byDay.get(s.day)!.push(s);
  }
  const out: Slot[] = [];
  let round = 0;
  while (out.length < n) {
    let added = false;
    for (const day of [...byDay.keys()].sort()) {
      const list = byDay.get(day)!;
      if (list[round]) {
        out.push(list[round]);
        added = true;
        if (out.length >= n) break;
      }
    }
    if (!added) break;
    round++;
  }
  return out;
}

function dedupe(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  return slots.filter((s) => {
    const k = `${s.doctorId}|${s.startUtc}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const schedulingAgent: AgentDef<SchedulingInput, SchedulingResult> = {
  name: "scheduling",
  feedVerb: (i) =>
    `Searching valid slots for ${i.requests.length} appointment${i.requests.length === 1 ? "" : "s"}`,
  system: `You are SchediCare's Scheduling agent for a single outpatient clinic (Asia/Manila).
You NEVER invent times. Every option you submit must come VERBATIM (doctorId + startUtc + endUtc) from find_open_slots results in this conversation — those results already respect doctor rules, buffers, daily/block caps, unavailability, and Google Calendar busy blocks.
Search strategy: same doctor first across the requested window; widen to the other doctor starting same-day when same-doctor supply is thin. The slot tool enforces the clinic's minimum notice period. Honor any afterTime/dayPart constraint exactly. Offer up to 8 options per appointment, spread across days rather than clustered. If a search returns nothing, say so in the note rather than relaxing constraints silently.
Finish with submit_result.`,
  tools: [
    toolToday,
    toolGetDoctors,
    toolGetDoctorRules,
    toolFindOpenSlots,
    toolGetDayLoad,
  ],
  resultSchema: SchedulingResultSchema,
  maxSteps: 12,
  buildPrompt: (i) =>
    `Case ${i.caseId}. Find rule-valid rescheduling options for these appointments:\n` +
    i.requests
      .map(
        (r) =>
          `- appointment ${r.appointmentId} (patient ${r.patientId}, type ${r.type}) originally ${r.originalStartUtc} with doctor ${r.originalDoctorId}; search ${r.searchFromDay}..${r.searchToDay}${r.afterTime ? `, only after ${r.afterTime} clinic time` : ""}${r.dayPart ? `, ${r.dayPart.toUpperCase()} only` : ""}`,
      )
      .join("\n") +
    `\nUse find_open_slots (pass ignoreAppointmentId when searching the original doctor). Submit options per appointment.`,
  fallback: async (i) => deterministicSearch(i),
};

/** Default search window: from a given day, spanning `days` days. */
export function searchWindow(
  fromDay: string,
  days = 7,
): { fromDay: string; toDay: string } {
  const from = new Date(`${fromDay}T00:00:00Z`);
  return { fromDay, toDay: format(addDays(from, days - 1), "yyyy-MM-dd") };
}

export function runScheduling(input: SchedulingInput, ctx: AgentCtx) {
  return runAgent(schedulingAgent, input, ctx);
}
