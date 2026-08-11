/**
 * Demo seed for Riverside Family Clinic (Pasig City). All data is fictional.
 * Fixed ids keep tests reproducible; dates follow the configured application
 * clock so a live presentation has realistic history and upcoming visits.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { addDays, addMinutes, format, getISODay } from "date-fns";
import { db, schema } from "@/core/db/client";
import { ensureSchema, wipeData } from "@/core/db/migrate";
import { SANTOS_RULES, REYES_RULES } from "@/core/rules";
import { env, CLINIC_TZ } from "@/core/env";
import { demoNow, demoToday } from "@/core/clock";

export const CLINIC_ID = "clinic_riverside";
export const SANTOS = "doc_santos";
export const REYES = "doc_reyes";

const DUR: Record<string, number> = { routine: 30, follow_up: 20, urgent: 30 };

function utc(day: string, hhmm: string): string {
  return fromZonedTime(`${day}T${hhmm}:00`, CLINIC_TZ).toISOString();
}
function end(day: string, hhmm: string, type: string): string {
  return addMinutes(new Date(utc(day, hhmm)), DUR[type]).toISOString();
}
function offsetDay(baseDay: string, offset: number): string {
  return format(
    addDays(new Date(`${baseDay}T00:00:00Z`), offset),
    "yyyy-MM-dd",
  );
}

/**
 * Once today's clinic has opened, use the next Santos working day for the
 * showcase disruption. An afternoon demo therefore always has upcoming
 * appointments to recover.
 */
export function demoCascadeDay(): string {
  let candidate = demoToday();
  const clinicHour = Number(formatInTimeZone(demoNow(), CLINIC_TZ, "H"));
  if (clinicHour >= 8) candidate = offsetDay(candidate, 1);
  while (
    !SANTOS_RULES.workDays.includes(
      getISODay(new Date(`${candidate}T00:00:00Z`)),
    )
  )
    candidate = offsetDay(candidate, 1);
  return candidate;
}

function day(offsetFromDemoDay: number): string {
  return offsetDay(demoCascadeDay(), offsetFromDemoDay);
}

function email(key: string): string {
  const base = env().DEMO_PATIENT_EMAIL;
  if (base && base.includes("@")) {
    const at = base.lastIndexOf("@");
    const user = base.slice(0, at);
    const domain = base.slice(at + 1);
    return `${user}+${key}@${domain}`;
  }
  return `${key}@riverside-demo.example`;
}

interface PatientSeed {
  id: string;
  name: string;
  key: string;
  prefDayPart?: "am" | "pm" | "any";
  preferredDoctorId?: string;
  notes?: string;
}

const NAMED: PatientSeed[] = [
  {
    id: "pat_teresa",
    key: "teresa.navarro",
    name: "Teresa Navarro",
    prefDayPart: "am",
    notes: "Post-op knee follow-up series with Dr. Santos.",
    preferredDoctorId: SANTOS,
  },
  {
    id: "pat_jose",
    key: "jose.ramos",
    name: "Jose Ramos",
    prefDayPart: "am",
    notes: "Hypertension follow-up program.",
  },
  {
    id: "pat_grace",
    key: "grace.villanueva",
    name: "Grace Villanueva",
    prefDayPart: "any",
    notes: "Preferred salutation: Ms.",
  },
  {
    id: "pat_camille",
    key: "camille.ocampo",
    name: "Camille Ocampo",
    prefDayPart: "any",
    notes: "Preferred salutation: Ms.",
  },
  {
    id: "pat_miguel",
    key: "miguel.torres",
    name: "Miguel Torres",
    prefDayPart: "pm",
    notes:
      "Preferred salutation: Sir. Works day shifts in Ortigas; prefers late afternoons.",
  },
  {
    id: "pat_andres",
    key: "andres.salazar",
    name: "Andres Salazar",
    prefDayPart: "any",
  },
  {
    id: "pat_paolo",
    key: "paolo.garcia",
    name: "Paolo Garcia",
    prefDayPart: "am",
  },
  {
    id: "pat_dennis",
    key: "dennis.castillo",
    name: "Dennis Castillo",
    prefDayPart: "pm",
  },
  {
    id: "pat_liza",
    key: "liza.soriano",
    name: "Liza Soriano",
    prefDayPart: "am",
  },
  {
    id: "pat_maria",
    key: "maria.delacruz",
    name: "Maria Dela Cruz",
    prefDayPart: "am",
    preferredDoctorId: SANTOS,
  },
  {
    id: "pat_rosa",
    key: "rosa.domingo",
    name: "Rosa Domingo",
    prefDayPart: "am",
    preferredDoctorId: REYES,
  },
  {
    id: "pat_vicente",
    key: "vicente.cruz",
    name: "Vicente Cruz",
    prefDayPart: "any",
  },
  {
    id: "pat_nica",
    key: "nica.alonzo",
    name: "Nica Alonzo",
    prefDayPart: "pm",
  },
  {
    id: "pat_bien",
    key: "bien.corpuz",
    name: "Bien Corpuz",
    prefDayPart: "pm",
  },
];

const FILLER_NAMES = [
  "Alonzo Reyes",
  "Bea Santiago",
  "Carlo Mendoza",
  "Diane Aquino",
  "Emman Bautista",
  "Faith Villar",
  "Gio Dizon",
  "Hannah Pascual",
  "Ivan Robles",
  "Jasmine Uy",
  "Kiko Fernandez",
  "Lea Marasigan",
  "Marco Lim",
  "Nina Padilla",
  "Oscar Trinidad",
  "Pia Salcedo",
  "Quintin Ferrer",
  "Rhea Manalo",
];

function patientSeeds(): PatientSeed[] {
  return [
    ...NAMED,
    ...FILLER_NAMES.map((name, i) => ({
      id: `pat_f${String(i + 1).padStart(2, "0")}`,
      key: name.toLowerCase().replace(/[^a-z]+/g, "."),
      name,
      prefDayPart: (["am", "pm", "any"] as const)[i % 3],
    })),
  ];
}

/** Refresh seeded patient aliases without resetting appointments or integration state. */
export function syncSeededPatientEmails(): number {
  let updated = 0;
  for (const patient of patientSeeds()) {
    const result = db
      .update(schema.patients)
      .set({ email: email(patient.key) })
      .where(eq(schema.patients.id, patient.id))
      .run();
    updated += result.changes;
  }
  return updated;
}

export interface SeedSummary {
  patients: number;
  appointments: number;
  demoDayAffected: number;
  demoDay: string;
  waitlist: number;
}

export interface SeedOptions {
  /** Keep Google OAuth tokens and doctor calendar mappings across a reset. */
  preserveIntegrations?: boolean;
}

/**
 * "full" keeps all six regression patients. "lite" is the presentation path:
 * Camille accepts, Grace declines, and Miguel counters once before accepting.
 * Those replies arrive through real Gmail in live mode; seed never injects them.
 */
export function seed(
  profile: "full" | "lite" = "full",
  opts: SeedOptions = {},
): SeedSummary {
  ensureSchema();
  const preservedMappings = opts.preserveIntegrations
    ? new Map(
        db
          .select({
            id: schema.doctors.id,
            calendarId: schema.doctors.calendarId,
          })
          .from(schema.doctors)
          .all()
          .filter((d) => d.calendarId)
          .map((d) => [d.id, d.calendarId!]),
      )
    : new Map<string, string>();
  wipeData({ keepOauth: opts.preserveIntegrations });
  const now = new Date().toISOString();
  const demoDay = demoCascadeDay();
  const santosCalendarId = preservedMappings.get(SANTOS) ?? "sim-santos";
  const reyesCalendarId = preservedMappings.get(REYES) ?? "sim-reyes";

  db.insert(schema.clinics)
    .values({
      id: CLINIC_ID,
      name: "Riverside Family Clinic",
      address: "Km. 12 Riverside Drive, Pasig City",
      timezone: CLINIC_TZ,
      createdAt: now,
    })
    .run();

  db.insert(schema.doctors)
    .values([
      {
        id: SANTOS,
        clinicId: CLINIC_ID,
        name: "Dr. Elena Santos",
        specialty: "Family Medicine",
        email: "e.santos@riverside-clinic.example",
        color: "#5B2FCE",
        initials: "ES",
        calendarId: santosCalendarId,
        status: "available",
        unavailableDates: [],
        createdAt: now,
      },
      {
        id: REYES,
        clinicId: CLINIC_ID,
        name: "Dr. Marco Reyes",
        specialty: "Family Medicine",
        email: "m.reyes@riverside-clinic.example",
        color: "#3D2A8C",
        initials: "MR",
        calendarId: reyesCalendarId,
        status: "available",
        unavailableDates: [],
        createdAt: now,
      },
    ])
    .run();

  db.insert(schema.doctorRules)
    .values([
      { doctorId: SANTOS, rules: SANTOS_RULES as any, updatedAt: now },
      { doctorId: REYES, rules: REYES_RULES as any, updatedAt: now },
    ])
    .run();

  const patients = patientSeeds();
  db.insert(schema.patients)
    .values(
      patients.map((p) => ({
        id: p.id,
        clinicId: CLINIC_ID,
        name: p.name,
        email: email(p.key),
        phone: `+63 917 ${String(1000000 + patients.indexOf(p) * 137).slice(0, 3)} ${String(2000 + patients.indexOf(p) * 61).slice(0, 4)}`,
        prefDayPart: p.prefDayPart ?? "any",
        preferredDoctorId: p.preferredDoctorId ?? null,
        notes: p.notes ?? null,
        createdAt: now,
      })),
    )
    .run();

  // Attendance history (drives risk scores and acceptance likelihood).
  const hist: Array<{
    patientId: string;
    kind: "attended" | "no_show" | "late_cancel" | "cancelled_ok";
    daysAgo: number;
  }> = [
    { patientId: "pat_teresa", kind: "attended", daysAgo: 40 },
    { patientId: "pat_teresa", kind: "attended", daysAgo: 26 },
    { patientId: "pat_teresa", kind: "attended", daysAgo: 12 },
    { patientId: "pat_jose", kind: "attended", daysAgo: 60 },
    { patientId: "pat_jose", kind: "attended", daysAgo: 30 },
    { patientId: "pat_jose", kind: "attended", daysAgo: 14 },
    { patientId: "pat_grace", kind: "attended", daysAgo: 90 },
    { patientId: "pat_grace", kind: "no_show", daysAgo: 21 },
    { patientId: "pat_camille", kind: "attended", daysAgo: 45 },
    { patientId: "pat_camille", kind: "attended", daysAgo: 10 },
    { patientId: "pat_miguel", kind: "attended", daysAgo: 75 },
    { patientId: "pat_miguel", kind: "attended", daysAgo: 50 },
    { patientId: "pat_miguel", kind: "attended", daysAgo: 25 },
    { patientId: "pat_miguel", kind: "attended", daysAgo: 8 },
    { patientId: "pat_dennis", kind: "no_show", daysAgo: 65 },
    { patientId: "pat_dennis", kind: "no_show", daysAgo: 33 },
    { patientId: "pat_dennis", kind: "late_cancel", daysAgo: 15 },
    { patientId: "pat_rosa", kind: "attended", daysAgo: 55 },
    { patientId: "pat_rosa", kind: "attended", daysAgo: 20 },
    { patientId: "pat_vicente", kind: "attended", daysAgo: 35 },
    { patientId: "pat_bien", kind: "no_show", daysAgo: 42 },
    { patientId: "pat_maria", kind: "attended", daysAgo: 28 },
  ];
  db.insert(schema.attendanceHistory)
    .values(
      hist.map((h, i) => ({
        id: `hist_${i}`,
        patientId: h.patientId,
        kind: h.kind,
        at: addDays(new Date(utc(demoDay, "08:00")), -h.daysAgo).toISOString(),
      })),
    )
    .run();

  // -------------------------------------------------------------------------
  // Appointments
  // -------------------------------------------------------------------------
  type ApptSeed = {
    id: string;
    doctorId: string;
    patientId: string;
    type: "routine" | "follow_up" | "urgent";
    day: string;
    time: string;
    status?: string;
    bookedDaysBefore?: number;
  };

  const appts: ApptSeed[] = [
    // ---- Flagship cascade: Dr. Santos, the dynamic showcase day ----
    {
      id: "appt_teresa",
      doctorId: SANTOS,
      patientId: "pat_teresa",
      type: "follow_up",
      day: demoDay,
      time: "08:30",
      status: "confirmed",
      bookedDaysBefore: 9,
    },
    {
      id: "appt_jose",
      doctorId: SANTOS,
      patientId: "pat_jose",
      type: "follow_up",
      day: demoDay,
      time: "09:10",
      status: "confirmed",
      bookedDaysBefore: 7,
    },
    {
      id: "appt_grace",
      doctorId: SANTOS,
      patientId: "pat_grace",
      type: "follow_up",
      day: demoDay,
      time: "09:50",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_camille",
      doctorId: SANTOS,
      patientId: "pat_camille",
      type: "urgent",
      day: demoDay,
      time: "10:40",
      status: "confirmed",
      bookedDaysBefore: 1,
    },
    {
      id: "appt_miguel",
      doctorId: SANTOS,
      patientId: "pat_miguel",
      type: "routine",
      day: demoDay,
      time: "13:30",
      status: "confirmed",
      bookedDaysBefore: 12,
    },
    {
      id: "appt_andres",
      doctorId: SANTOS,
      patientId: "pat_andres",
      type: "routine",
      day: demoDay,
      time: "14:20",
      status: "confirmed",
      bookedDaysBefore: 5,
    },

    // ---- Secondary scenarios ----
    // Unconfirmed within 36h → confirmation nudge case.
    {
      id: "appt_paolo",
      doctorId: REYES,
      patientId: "pat_paolo",
      type: "routine",
      day: day(1),
      time: "09:45",
      status: "booked",
      bookedDaysBefore: 8,
    },
    // High no-show risk → preventive outreach case (2 no-shows + late cancel + unconfirmed + long lead).
    {
      id: "appt_dennis",
      doctorId: SANTOS,
      patientId: "pat_dennis",
      type: "routine",
      day: day(3),
      time: "14:00",
      status: "booked",
      bookedDaysBefore: 20,
    },
    // Vacated future slot → waitlist backfill case.
    {
      id: "appt_liza",
      doctorId: REYES,
      patientId: "pat_liza",
      type: "routine",
      day: day(2),
      time: "10:00",
      status: "cancelled_by_patient",
      bookedDaysBefore: 10,
    },
    // Default /book patient's existing appointment.
    {
      id: "appt_maria",
      doctorId: SANTOS,
      patientId: "pat_maria",
      type: "follow_up",
      day: day(2),
      time: "08:30",
      status: "confirmed",
      bookedDaysBefore: 4,
    },

    // ---- Background load: Dr. Reyes demo day (unaffected, shows contrast) ----
    {
      id: "appt_bg01",
      doctorId: REYES,
      patientId: "pat_f01",
      type: "routine",
      day: demoDay,
      time: "08:30",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_bg02",
      doctorId: REYES,
      patientId: "pat_f02",
      type: "routine",
      day: demoDay,
      time: "09:30",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_bg03",
      doctorId: REYES,
      patientId: "pat_f03",
      type: "urgent",
      day: demoDay,
      time: "10:30",
      status: "confirmed",
      bookedDaysBefore: 0,
    },
    {
      id: "appt_bg04",
      doctorId: REYES,
      patientId: "pat_f04",
      type: "follow_up",
      day: demoDay,
      time: "13:30",
      status: "confirmed",
      bookedDaysBefore: 9,
    },

    // ---- Two weeks of realistic load (both doctors) ----
    {
      id: "appt_bg05",
      doctorId: SANTOS,
      patientId: "pat_f05",
      type: "follow_up",
      day: day(1),
      time: "08:00",
      status: "confirmed",
      bookedDaysBefore: 10,
    },
    {
      id: "appt_bg06",
      doctorId: SANTOS,
      patientId: "pat_f06",
      type: "follow_up",
      day: day(1),
      time: "09:00",
      status: "confirmed",
      bookedDaysBefore: 5,
    },
    {
      id: "appt_bg07",
      doctorId: SANTOS,
      patientId: "pat_f07",
      type: "routine",
      day: day(1),
      time: "13:00",
      status: "confirmed",
      bookedDaysBefore: 3,
    },
    {
      id: "appt_bg08",
      doctorId: SANTOS,
      patientId: "pat_f08",
      type: "routine",
      day: day(1),
      time: "15:00",
      status: "confirmed",
      bookedDaysBefore: 7,
    },
    {
      id: "appt_bg09",
      doctorId: REYES,
      patientId: "pat_f09",
      type: "routine",
      day: day(1),
      time: "08:45",
      status: "confirmed",
      bookedDaysBefore: 4,
    },
    {
      id: "appt_bg10",
      doctorId: REYES,
      patientId: "pat_f10",
      type: "follow_up",
      day: day(1),
      time: "14:00",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_bg11",
      doctorId: SANTOS,
      patientId: "pat_f11",
      type: "follow_up",
      day: day(2),
      time: "09:30",
      status: "confirmed",
      bookedDaysBefore: 8,
    },
    {
      id: "appt_bg12",
      doctorId: SANTOS,
      patientId: "pat_f12",
      type: "routine",
      day: day(2),
      time: "13:30",
      status: "booked",
      bookedDaysBefore: 2,
    },
    {
      id: "appt_bg13",
      doctorId: REYES,
      patientId: "pat_f13",
      type: "routine",
      day: day(2),
      time: "11:00",
      status: "confirmed",
      bookedDaysBefore: 5,
    },
    {
      id: "appt_bg14",
      doctorId: REYES,
      patientId: "pat_f14",
      type: "follow_up",
      day: day(2),
      time: "15:00",
      status: "confirmed",
      bookedDaysBefore: 9,
    },
    {
      id: "appt_bg15",
      doctorId: SANTOS,
      patientId: "pat_f15",
      type: "follow_up",
      day: day(3),
      time: "08:30",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_bg16",
      doctorId: SANTOS,
      patientId: "pat_f16",
      type: "routine",
      day: day(3),
      time: "15:30",
      status: "booked",
      bookedDaysBefore: 4,
    },
    {
      id: "appt_bg17",
      doctorId: REYES,
      patientId: "pat_f17",
      type: "routine",
      day: day(3),
      time: "09:45",
      status: "confirmed",
      bookedDaysBefore: 3,
    },
    {
      id: "appt_bg18",
      doctorId: REYES,
      patientId: "pat_f18",
      type: "urgent",
      day: day(3),
      time: "13:00",
      status: "booked",
      bookedDaysBefore: 1,
    },
    {
      id: "appt_bg19",
      doctorId: SANTOS,
      patientId: "pat_f01",
      type: "routine",
      day: day(4),
      time: "13:00",
      status: "confirmed",
      bookedDaysBefore: 11,
    },
    {
      id: "appt_bg20",
      doctorId: SANTOS,
      patientId: "pat_f02",
      type: "follow_up",
      day: day(4),
      time: "10:00",
      status: "booked",
      bookedDaysBefore: 5,
    },
    {
      id: "appt_bg21",
      doctorId: REYES,
      patientId: "pat_f03",
      type: "routine",
      day: day(4),
      time: "09:15",
      status: "confirmed",
      bookedDaysBefore: 7,
    },
    {
      id: "appt_bg22",
      doctorId: SANTOS,
      patientId: "pat_f04",
      type: "routine",
      day: day(5),
      time: "14:00",
      status: "confirmed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_bg23",
      doctorId: SANTOS,
      patientId: "pat_f05",
      type: "follow_up",
      day: day(8),
      time: "08:30",
      status: "booked",
      bookedDaysBefore: 4,
    },
    {
      id: "appt_bg24",
      doctorId: REYES,
      patientId: "pat_f06",
      type: "routine",
      day: day(8),
      time: "09:15",
      status: "confirmed",
      bookedDaysBefore: 9,
    },
    {
      id: "appt_bg25",
      doctorId: SANTOS,
      patientId: "pat_f07",
      type: "routine",
      day: day(9),
      time: "13:30",
      status: "confirmed",
      bookedDaysBefore: 8,
    },
    {
      id: "appt_bg26",
      doctorId: REYES,
      patientId: "pat_f08",
      type: "follow_up",
      day: day(9),
      time: "14:30",
      status: "booked",
      bookedDaysBefore: 3,
    },
    {
      id: "appt_bg27",
      doctorId: SANTOS,
      patientId: "pat_f09",
      type: "follow_up",
      day: day(10),
      time: "09:00",
      status: "confirmed",
      bookedDaysBefore: 12,
    },
    {
      id: "appt_bg28",
      doctorId: REYES,
      patientId: "pat_f10",
      type: "routine",
      day: day(10),
      time: "10:15",
      status: "confirmed",
      bookedDaysBefore: 5,
    },
    {
      id: "appt_bg29",
      doctorId: SANTOS,
      patientId: "pat_f13",
      type: "routine",
      day: day(11),
      time: "16:00",
      status: "booked",
      bookedDaysBefore: 2,
    },
    {
      id: "appt_bg30",
      doctorId: REYES,
      patientId: "pat_f14",
      type: "routine",
      day: day(11),
      time: "13:30",
      status: "confirmed",
      bookedDaysBefore: 7,
    },

    // ---- Last week (history on the calendar) ----
    {
      id: "appt_h01",
      doctorId: SANTOS,
      patientId: "pat_teresa",
      type: "follow_up",
      day: day(-5),
      time: "08:30",
      status: "completed",
      bookedDaysBefore: 9,
    },
    {
      id: "appt_h02",
      doctorId: SANTOS,
      patientId: "pat_f11",
      type: "routine",
      day: day(-4),
      time: "13:30",
      status: "completed",
      bookedDaysBefore: 6,
    },
    {
      id: "appt_h03",
      doctorId: REYES,
      patientId: "pat_f12",
      type: "routine",
      day: day(-4),
      time: "09:00",
      status: "completed",
      bookedDaysBefore: 5,
    },
    {
      id: "appt_h04",
      doctorId: SANTOS,
      patientId: "pat_dennis",
      type: "routine",
      day: day(-3),
      time: "14:30",
      status: "no_show",
      bookedDaysBefore: 15,
    },
    {
      id: "appt_h05",
      doctorId: REYES,
      patientId: "pat_f15",
      type: "follow_up",
      day: day(-3),
      time: "14:00",
      status: "completed",
      bookedDaysBefore: 4,
    },
  ];

  const LITE_DROPPED_APPOINTMENTS = new Set([
    "appt_teresa",
    "appt_jose",
    "appt_andres",
    "appt_paolo",
    "appt_dennis",
    "appt_liza",
  ]);
  const effectiveAppts =
    profile === "lite"
      ? appts.filter((a) => !LITE_DROPPED_APPOINTMENTS.has(a.id))
      : appts;

  const bookedAtFor = (a: ApptSeed) =>
    addDays(
      new Date(utc(a.day, a.time)),
      -(a.bookedDaysBefore ?? 5),
    ).toISOString();

  db.insert(schema.appointments)
    .values(
      effectiveAppts.map((a) => ({
        id: a.id,
        clinicId: CLINIC_ID,
        doctorId: a.doctorId,
        patientId: a.patientId,
        type: a.type,
        startUtc: utc(a.day, a.time),
        endUtc: end(a.day, a.time, a.type),
        status: (a.status ?? "booked") as any,
        calendarEventId: null,
        bookedAt: bookedAtFor(a),
        source: "seed",
        createdAt: bookedAtFor(a),
      })),
    )
    .run();

  // Mirror active appointments only for simulated mappings. With a preserved
  // live Google mapping, seeded rows intentionally have no external event id;
  // approved replacement holds create genuine Google events later.
  const active = effectiveAppts.filter(
    (a) => (a.status ?? "booked") === "booked" || a.status === "confirmed",
  );
  for (const a of active) {
    const calId = a.doctorId === SANTOS ? santosCalendarId : reyesCalendarId;
    if (!calId.startsWith("sim-")) continue;
    const evId = `simev_${a.id}`;
    db.insert(schema.simCalendarEvents)
      .values({
        id: evId,
        calendarId: calId,
        summary: `${patients.find((p) => p.id === a.patientId)?.name ?? a.patientId} — ${a.type.replace("_", " ")}`,
        startUtc: utc(a.day, a.time),
        endUtc: end(a.day, a.time, a.type),
        status: "confirmed",
        createdAt: now,
      })
      .run();
    db.update(schema.appointments)
      .set({ calendarEventId: evId })
      .where(eqId(a.id))
      .run();
  }

  // Personal busy blocks on the doctors' external calendars (not SchediCare
  // appointments) — proves external busy time is respected by the slot engine.
  db.insert(schema.simCalendarEvents)
    .values([
      {
        id: "simev_busy1",
        calendarId: "sim-santos",
        summary: "Barangay health outreach",
        startUtc: utc(day(2), "15:00"),
        endUtc: utc(day(2), "16:00"),
        status: "confirmed",
        createdAt: now,
      },
      {
        id: "simev_busy2",
        calendarId: "sim-reyes",
        summary: "Hospital rounds",
        startUtc: utc(day(4), "08:00"),
        endUtc: utc(day(4), "09:00"),
        status: "confirmed",
        createdAt: now,
      },
    ])
    .run();

  // Waitlist (Rosa should win Liza's vacated Wednesday 10:00 AM routine slot with Dr. Reyes).
  db.insert(schema.waitlist)
    .values([
      {
        id: "wl_rosa",
        clinicId: CLINIC_ID,
        patientId: "pat_rosa",
        doctorId: REYES,
        type: "routine",
        dayPart: "am",
        addedAt: addDays(new Date(utc(demoDay, "08:00")), -18).toISOString(),
        status: "waiting",
      },
      {
        id: "wl_vicente",
        clinicId: CLINIC_ID,
        patientId: "pat_vicente",
        doctorId: null,
        type: "routine",
        dayPart: "any",
        addedAt: addDays(new Date(utc(demoDay, "08:00")), -10).toISOString(),
        status: "waiting",
      },
      {
        id: "wl_nica",
        clinicId: CLINIC_ID,
        patientId: "pat_nica",
        doctorId: null,
        type: "follow_up",
        dayPart: "pm",
        addedAt: addDays(new Date(utc(demoDay, "08:00")), -12).toISOString(),
        status: "waiting",
      },
      {
        id: "wl_bien",
        clinicId: CLINIC_ID,
        patientId: "pat_bien",
        doctorId: null,
        type: "routine",
        dayPart: "pm",
        addedAt: addDays(new Date(utc(demoDay, "08:00")), -3).toISOString(),
        status: "waiting",
      },
    ])
    .run();

  return {
    patients: patients.length,
    appointments: effectiveAppts.length,
    demoDayAffected: profile === "lite" ? 3 : 6,
    demoDay,
    waitlist: 4,
  };
}

function eqId(id: string) {
  return eq(schema.appointments.id, id);
}
