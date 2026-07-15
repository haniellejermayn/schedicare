/**
 * Deterministic slot engine. Pure functions only: given rules, existing
 * appointments, external busy intervals, and a search range, produce the set
 * of valid slots. LLM agents may choose among these slots and explain them —
 * they can never invent one. validatePlacement() is re-run at decision time
 * and again at execution time (the approval gate's hard validator).
 */
import { addDays, addMinutes, getISODay, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { CLINIC_TZ } from "./env";
import type { ApptType, Interval, RuleSet, Slot } from "./types";

export interface SlotQuery {
  doctorId: string;
  rules: RuleSet;
  type: ApptType;
  /** Inclusive clinic-local date range yyyy-MM-dd. */
  fromDay: string;
  toDay: string;
  /** Active appointments for this doctor in/near the range (any status filtering done by caller). */
  existing: Interval[];
  /** External busy intervals (e.g. Google Calendar events not tracked as appointments). */
  busy?: Interval[];
  /** Clinic-local dates the doctor is unavailable. */
  unavailableDates?: string[];
  /** Slots must start at/after this instant (defaults to epoch — caller passes demoNow). */
  notBefore?: Date;
  stepMin?: number;
  /** Optional extra constraints (from patient counter-proposals). */
  afterTime?: string; // HH:mm clinic-local
  beforeTime?: string; // HH:mm clinic-local
  dayPart?: "am" | "pm";
}

function overlaps(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS < bE && bS < aE;
}

function* localDays(fromDay: string, toDay: string): Generator<string> {
  let d = parseISO(`${fromDay}T00:00:00Z`);
  const end = parseISO(`${toDay}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d = addDays(d, 1);
  }
}

function localToUtc(day: string, hhmm: string): Date {
  return fromZonedTime(`${day}T${hhmm}:00`, CLINIC_TZ);
}

export function localDayOf(startUtc: string | Date): string {
  return formatInTimeZone(new Date(startUtc), CLINIC_TZ, "yyyy-MM-dd");
}

export function blockOf(startUtc: string | Date): "am" | "pm" {
  const h = Number(formatInTimeZone(typeof startUtc === "string" ? new Date(startUtc) : startUtc, CLINIC_TZ, "H"));
  return h < 12 ? "am" : "pm";
}

/** Generate every valid slot in the range. Deterministic; no IO. */
export function generateSlots(q: SlotQuery): Slot[] {
  const step = q.stepMin ?? 10;
  const dur = q.rules.durationMin[q.type];
  const windows = q.rules.windows[q.type] ?? [];
  if (!dur || windows.length === 0) return [];
  const notBefore = q.notBefore ?? new Date(0);
  const buffer = q.rules.bufferAfterMin;

  const blocked: Array<{ s: Date; e: Date }> = [...q.existing, ...(q.busy ?? [])].map((i) => ({
    s: new Date(i.startUtc),
    // Trailing buffer applies after every blocked interval.
    e: addMinutes(new Date(i.endUtc), buffer),
  }));

  const out: Slot[] = [];
  for (const day of localDays(q.fromDay, q.toDay)) {
    if (q.unavailableDates?.includes(day)) continue;
    const isoDow = getISODay(localToUtc(day, "12:00"));
    if (!q.rules.workDays.includes(isoDow)) continue;

    const dayStart = localToUtc(day, "00:00");
    const dayEnd = addDays(dayStart, 1);
    const dayExisting = q.existing.filter((i) =>
      overlaps(new Date(i.startUtc), new Date(i.endUtc), dayStart, dayEnd)
    );
    if (dayExisting.length >= q.rules.maxPerDay) continue;
    const blockCount = {
      am: dayExisting.filter((i) => blockOf(i.startUtc) === "am").length,
      pm: dayExisting.filter((i) => blockOf(i.startUtc) === "pm").length,
    };

    for (const win of windows) {
      const [from, to] = win.split("-");
      let t = localToUtc(day, from);
      const winEnd = localToUtc(day, to);
      while (addMinutes(t, dur) <= winEnd) {
        const end = addMinutes(t, dur);
        const block = blockOf(t);
        const startHHmm = formatInTimeZone(t, CLINIC_TZ, "HH:mm");
        const ok =
          t >= notBefore &&
          blockCount[block] < q.rules.maxPerBlock[block] &&
          (!q.dayPart || q.dayPart === block) &&
          (!q.afterTime || startHHmm >= q.afterTime) &&
          (!q.beforeTime || startHHmm < q.beforeTime) &&
          // The new appointment's own trailing buffer must also fit before any block.
          !blocked.some((b) => overlaps(t, addMinutes(end, buffer), b.s, b.e));
        if (ok) out.push({ doctorId: q.doctorId, startUtc: t.toISOString(), endUtc: end.toISOString(), block, day });
        t = addMinutes(t, step);
      }
    }
  }
  return out;
}

/**
 * Hard validator: would the engine accept this exact placement right now?
 * Checks every rule directly (workday, unavailability, window containment,
 * caps, buffered conflicts, not-in-the-past) rather than grid membership, so
 * legitimate off-grid bookings (e.g. front-desk entries) validate too. The
 * executor refuses any placement that fails this check.
 */
export function validatePlacement(
  q: Omit<SlotQuery, "fromDay" | "toDay">,
  startUtc: string
): { ok: boolean; reason?: string } {
  const start = new Date(startUtc);
  const dur = q.rules.durationMin[q.type];
  const windows = q.rules.windows[q.type] ?? [];
  if (!dur || windows.length === 0) return { ok: false, reason: `Doctor takes no ${q.type} visits` };
  const end = addMinutes(start, dur);
  const buffer = q.rules.bufferAfterMin;
  const day = formatInTimeZone(start, CLINIC_TZ, "yyyy-MM-dd");

  if (q.notBefore && start < q.notBefore) return { ok: false, reason: "Slot is in the past" };
  if (q.unavailableDates?.includes(day)) return { ok: false, reason: `Doctor is marked unavailable on ${day}` };
  const isoDow = getISODay(localToUtc(day, "12:00"));
  if (!q.rules.workDays.includes(isoDow)) return { ok: false, reason: `Doctor does not work on ${day}` };

  const inWindow = windows.some((w) => {
    const [from, to] = w.split("-");
    return start >= localToUtc(day, from) && end <= localToUtc(day, to);
  });
  if (!inWindow) return { ok: false, reason: `Outside the doctor's ${q.type.replace("_", " ")} hours (${windows.join(", ")})` };

  const dayStart = localToUtc(day, "00:00");
  const dayEnd = addDays(dayStart, 1);
  const dayExisting = q.existing.filter((i) => overlaps(new Date(i.startUtc), new Date(i.endUtc), dayStart, dayEnd));
  if (dayExisting.length >= q.rules.maxPerDay) return { ok: false, reason: "Doctor's day is at capacity" };
  const block = blockOf(startUtc);
  const blockLoad = dayExisting.filter((i) => blockOf(i.startUtc) === block).length;
  if (blockLoad >= q.rules.maxPerBlock[block]) return { ok: false, reason: `The ${block.toUpperCase()} block is at capacity` };

  // Buffered conflicts on both sides: each interval owns a trailing buffer.
  const conflict = [...q.existing, ...(q.busy ?? [])].some((i) =>
    overlaps(start, addMinutes(end, buffer), new Date(i.startUtc), addMinutes(new Date(i.endUtc), buffer))
  );
  if (conflict) return { ok: false, reason: "Conflicts with an existing booking or calendar block (including buffer time)" };

  return { ok: true };
}
