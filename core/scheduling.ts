/**
 * Scheduling façade over the pure slot engine: loads doctor rules, active
 * appointments, doctor unavailability, and external calendar busy blocks, then
 * asks core/slots for valid slots. This is the ONLY place agents can get
 * times from, and validatePlacementNow() is the hard gate re-run before every
 * calendar write.
 */
import { addDays, addMinutes } from "date-fns";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { db, schema } from "./db/client";
import { demoNow } from "./clock";
import { getRules } from "./rules";
import { generateSlots, validatePlacement } from "./slots";
import { getBusyIntervals } from "@/integrations/factory";
import type { ApptType, Interval, Slot } from "./types";
import { fromZonedTime } from "date-fns-tz";
import { CLINIC_TZ } from "./env";

const ACTIVE_STATUSES = ["booked", "confirmed"] as const;

/** Minimum lead time for clinic-initiated replacement offers. */
export const RESCHEDULE_MIN_NOTICE_MINUTES = 4 * 60;

export interface FindSlotsOptions {
  doctorId: string;
  type: ApptType;
  fromDay: string; // clinic-local yyyy-MM-dd
  toDay: string;
  afterTime?: string;
  beforeTime?: string;
  dayPart?: "am" | "pm";
  /** Exclude one appointment from conflict checks (when rescheduling it). */
  ignoreAppointmentId?: string;
  minimumNoticeMinutes?: number;
  limit?: number;
}

function rangeUtc(fromDay: string, toDay: string) {
  const startUtc = fromZonedTime(`${fromDay}T00:00:00`, CLINIC_TZ).toISOString();
  const endUtc = addDays(fromZonedTime(`${toDay}T00:00:00`, CLINIC_TZ), 1).toISOString();
  return { startUtc, endUtc };
}

function activeAppointments(doctorId: string, range: { startUtc: string; endUtc: string }, ignoreId?: string): Interval[] {
  const rows = db
    .select({ id: schema.appointments.id, startUtc: schema.appointments.startUtc, endUtc: schema.appointments.endUtc })
    .from(schema.appointments)
    .where(
      and(
        eq(schema.appointments.doctorId, doctorId),
        inArray(schema.appointments.status, [...ACTIVE_STATUSES]),
        lt(schema.appointments.startUtc, range.endUtc),
        gt(schema.appointments.endUtc, range.startUtc)
      )
    )
    .all();
  return rows.filter((r) => r.id !== ignoreId).map(({ startUtc, endUtc }) => ({ startUtc, endUtc }));
}

/**
 * External busy = provider events minus intervals we already track as
 * appointments (so the doctor's SchediCare bookings aren't double-counted when
 * they also exist on the live calendar).
 */
function subtractKnown(busy: Interval[], known: Interval[]): Interval[] {
  return busy.filter(
    (b) => !known.some((k) => k.startUtc === b.startUtc || (b.startUtc >= k.startUtc && b.endUtc <= k.endUtc))
  );
}

export async function findOpenSlots(opts: FindSlotsOptions): Promise<Slot[]> {
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, opts.doctorId)).get();
  if (!doctor) throw new Error(`doctor ${opts.doctorId} not found`);
  const rules = getRules(opts.doctorId);
  const range = rangeUtc(opts.fromDay, opts.toDay);
  const existing = activeAppointments(opts.doctorId, range, opts.ignoreAppointmentId);
  // Subtract calendar mirrors of ALL active appointments (including an ignored
  // one being replaced — its event goes away with it) so they aren't double-counted.
  const known = activeAppointments(opts.doctorId, range);
  const rawBusy = await getBusyIntervals(doctor.calendarId, range);
  const busy = subtractKnown(rawBusy, known);
  const notBefore = addMinutes(demoNow(), opts.minimumNoticeMinutes ?? 0);
  const slots = generateSlots({
    doctorId: opts.doctorId,
    rules,
    type: opts.type,
    fromDay: opts.fromDay,
    toDay: opts.toDay,
    existing,
    busy,
    unavailableDates: (doctor.unavailableDates as string[]) ?? [],
    notBefore,
    afterTime: opts.afterTime,
    beforeTime: opts.beforeTime,
    dayPart: opts.dayPart,
  });
  return opts.limit ? slots.slice(0, opts.limit) : slots;
}

export async function validatePlacementNow(input: {
  doctorId: string;
  type: ApptType;
  startUtc: string;
  ignoreAppointmentId?: string;
  minimumNoticeMinutes?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const doctor = db.select().from(schema.doctors).where(eq(schema.doctors.id, input.doctorId)).get();
  if (!doctor) return { ok: false, reason: `doctor ${input.doctorId} not found` };
  const rules = getRules(input.doctorId);
  const day = new Date(input.startUtc);
  const dayStr = day.toISOString(); // validatePlacement derives clinic-local day itself
  const range = rangeUtc(dayStr.slice(0, 10), dayStr.slice(0, 10));
  // Widen the range by a day both ways so timezone edges never clip conflicts.
  const wide = {
    startUtc: addDays(new Date(range.startUtc), -1).toISOString(),
    endUtc: addDays(new Date(range.endUtc), 1).toISOString(),
  };
  const existing = activeAppointments(input.doctorId, wide, input.ignoreAppointmentId);
  const known = activeAppointments(input.doctorId, wide);
  const rawBusy = await getBusyIntervals(doctor.calendarId, wide);
  const busy = subtractKnown(rawBusy, known);
  const notBefore = addMinutes(demoNow(), input.minimumNoticeMinutes ?? 0);
  const result = validatePlacement(
    {
      doctorId: input.doctorId,
      rules,
      type: input.type,
      existing,
      busy,
      unavailableDates: (doctor.unavailableDates as string[]) ?? [],
      notBefore,
    },
    input.startUtc
  );
  if (
    !result.ok &&
    input.minimumNoticeMinutes &&
    new Date(input.startUtc) < notBefore
  ) {
    const hours = input.minimumNoticeMinutes / 60;
    return {
      ok: false,
      reason: `Replacement offers require at least ${hours} hours' notice`,
    };
  }
  return result;
}

/** Fraction of a doctor's maxPerDay already booked on a clinic-local day. */
export function dayLoad(doctorId: string, day: string): number {
  const rules = getRules(doctorId);
  const range = rangeUtc(day, day);
  const count = activeAppointments(doctorId, range).length;
  return Math.min(1, count / rules.maxPerDay);
}
