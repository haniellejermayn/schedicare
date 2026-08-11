import { eq } from "drizzle-orm";
import { db, schema } from "@/core/db/client";
import { env } from "@/core/env";
import { calendarConnectionState } from "@/integrations/factory";
import { GoogleCalendarProvider } from "@/integrations/calendar/google";
import type { CalendarProvider } from "@/integrations/calendar/types";
import { REYES, SANTOS } from "@/sim/seed";

type DemoCalendarAdmin = Pick<CalendarProvider, "createEvent"> & {
  deleteAllEvents(calendarId: string): Promise<number>;
};

export interface DemoCalendarSyncSummary {
  calendarsCleared: number;
  eventsDeleted: number;
  appointmentsCreated: number;
  busyBlocksCreated: number;
  skipped?: string;
}

const DEDICATED_GOOGLE_CALENDAR = /@group\.calendar\.google\.com$/i;

function mappedDoctors() {
  return db
    .select({
      id: schema.doctors.id,
      name: schema.doctors.name,
      calendarId: schema.doctors.calendarId,
    })
    .from(schema.doctors)
    .all()
    .filter(
      (doctor): doctor is typeof doctor & { calendarId: string } =>
        !!doctor.calendarId && !doctor.calendarId.startsWith("sim-"),
    );
}

function validateDedicatedMappings(
  doctors: ReturnType<typeof mappedDoctors>,
): void {
  const invalid = doctors.filter(
    (doctor) => !DEDICATED_GOOGLE_CALENDAR.test(doctor.calendarId),
  );
  if (invalid.length) {
    throw new Error(
      `Refusing to clear ${invalid.map((doctor) => doctor.name).join(", ")}: npm run demo only resets a dedicated secondary Google calendar whose ID ends in @group.calendar.google.com.`,
    );
  }
  const ids = doctors.map((doctor) => doctor.calendarId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(
      "Refusing to reset: each doctor must be mapped to a different dedicated Google demo calendar.",
    );
  }
}

/**
 * Clear validated demo calendars and mirror the freshly seeded SQLite state.
 * The caller supplies the Google admin in tests so no network access occurs.
 */
export async function syncMappedDemoCalendars(
  provider: DemoCalendarAdmin,
): Promise<DemoCalendarSyncSummary> {
  const doctors = mappedDoctors();
  if (!doctors.length) {
    return {
      calendarsCleared: 0,
      eventsDeleted: 0,
      appointmentsCreated: 0,
      busyBlocksCreated: 0,
      skipped: "no live doctor-calendar mappings",
    };
  }
  validateDedicatedMappings(doctors);

  const doctorById = new Map(doctors.map((doctor) => [doctor.id, doctor]));
  const patientById = new Map(
    db
      .select({ id: schema.patients.id, name: schema.patients.name })
      .from(schema.patients)
      .all()
      .map((patient) => [patient.id, patient]),
  );
  const appointments = db
    .select()
    .from(schema.appointments)
    .all()
    .filter(
      (appointment) =>
        ["booked", "confirmed"].includes(appointment.status) &&
        doctorById.has(appointment.doctorId),
    );
  const simCalendarToDoctor = new Map([
    ["sim-santos", SANTOS],
    ["sim-reyes", REYES],
  ]);
  const busyBlocks = db
    .select()
    .from(schema.simCalendarEvents)
    .all()
    .flatMap((event) => {
      if (!event.id.startsWith("simev_busy")) return [];
      const doctorId = simCalendarToDoctor.get(event.calendarId);
      const doctor = doctorId ? doctorById.get(doctorId) : undefined;
      return doctor ? [{ event, calendarId: doctor.calendarId }] : [];
    });

  let eventsDeleted = 0;
  for (const doctor of doctors) {
    console.log(
      `[demo] Clearing dedicated calendar for ${doctor.name}: ${doctor.calendarId}`,
    );
    eventsDeleted += await provider.deleteAllEvents(doctor.calendarId);
  }

  for (const appointment of appointments) {
    const doctor = doctorById.get(appointment.doctorId)!;
    const patient = patientById.get(appointment.patientId);
    const created = await provider.createEvent({
      calendarId: doctor.calendarId,
      summary: `${patient?.name ?? appointment.patientId} — ${appointment.type.replace("_", " ")}`,
      description: `[SchediCare demo seed] Appointment ${appointment.id}`,
      startUtc: appointment.startUtc,
      endUtc: appointment.endUtc,
    });
    db.update(schema.appointments)
      .set({ calendarEventId: created.id })
      .where(eq(schema.appointments.id, appointment.id))
      .run();
  }

  for (const { event, calendarId } of busyBlocks) {
    await provider.createEvent({
      calendarId,
      summary: event.summary,
      description: "[SchediCare demo seed] External busy block",
      startUtc: event.startUtc,
      endUtc: event.endUtc,
    });
  }

  return {
    calendarsCleared: doctors.length,
    eventsDeleted,
    appointmentsCreated: appointments.length,
    busyBlocksCreated: busyBlocks.length,
  };
}

/** Resolve the live Google connection used by npm run demo. */
export async function syncConnectedDemoCalendars(): Promise<DemoCalendarSyncSummary> {
  if (env().CALENDAR_PROVIDER !== "google") {
    return {
      calendarsCleared: 0,
      eventsDeleted: 0,
      appointmentsCreated: 0,
      busyBlocksCreated: 0,
      skipped: "CALENDAR_PROVIDER is simulated",
    };
  }
  if (!mappedDoctors().length) {
    return {
      calendarsCleared: 0,
      eventsDeleted: 0,
      appointmentsCreated: 0,
      busyBlocksCreated: 0,
      skipped: "no live doctor-calendar mappings",
    };
  }
  const connection = calendarConnectionState();
  if (connection !== "ok") {
    throw new Error(
      connection === "no_tokens"
        ? "Google calendars are mapped but OAuth is not connected. Reconnect Google before npm run demo."
        : "Google calendars are mapped but Google OAuth is not configured.",
    );
  }
  return syncMappedDemoCalendars(new GoogleCalendarProvider());
}
